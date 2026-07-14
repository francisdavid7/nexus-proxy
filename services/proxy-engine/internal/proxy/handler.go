package proxy

import (
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/auth"
)

type Handler struct {
	authenticator  *auth.BasicAuthenticator
	validator      *DestinationValidator
	transport      *http.Transport
	connectTimeout time.Duration
}

func NewHandler(
	authenticator *auth.BasicAuthenticator,
	validator *DestinationValidator,
	connectTimeout time.Duration,
) *Handler {
	dialer := &net.Dialer{
		Timeout:   connectTimeout,
		KeepAlive: 30 * time.Second,
	}

	transport := &http.Transport{
		Proxy:                 nil,
		DialContext:           dialer.DialContext,
		ForceAttemptHTTP2:     false,
		MaxIdleConns:          200,
		MaxIdleConnsPerHost:   20,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: time.Second,
		DisableCompression:    false,
	}

	return &Handler{
		authenticator:  authenticator,
		validator:      validator,
		transport:      transport,
		connectTimeout: connectTimeout,
	}
}

func (h *Handler) ServeHTTP(
	writer http.ResponseWriter,
	request *http.Request,
) {
	if !h.authenticator.Authenticate(request) {
		writer.Header().Set(
			"Proxy-Authenticate",
			`Basic realm="Nexus Proxy"`,
		)

		http.Error(
			writer,
			"proxy authentication required",
			http.StatusProxyAuthRequired,
		)

		return
	}

	request.Header.Del("Proxy-Authorization")

	if request.Method == http.MethodConnect {
		h.handleConnect(writer, request)
		return
	}

	h.handleHTTP(writer, request)
}

func (h *Handler) handleHTTP(
	writer http.ResponseWriter,
	request *http.Request,
) {
	if request.URL == nil || request.URL.Host == "" {
		http.Error(
			writer,
			"absolute destination URL is required",
			http.StatusBadRequest,
		)
		return
	}

	if request.URL.Scheme != "http" {
		http.Error(
			writer,
			"unsupported URL scheme",
			http.StatusBadRequest,
		)
		return
	}

	if err := h.validator.Validate(
		request.Context(),
		request.URL.Host,
	); err != nil {
		log.Printf(
			"blocked HTTP destination %q: %v",
			request.URL.Host,
			err,
		)

		http.Error(
			writer,
			"destination is not allowed",
			http.StatusForbidden,
		)
		return
	}

	outboundRequest := request.Clone(request.Context())

	outboundRequest.RequestURI = ""
	outboundRequest.Close = false

	removeHopByHopHeaders(outboundRequest.Header)
	removeIdentityHeaders(outboundRequest.Header)

	response, err := h.transport.RoundTrip(outboundRequest)
	if err != nil {
		log.Printf(
			"HTTP forwarding failed for %s: %v",
			request.URL.String(),
			err,
		)

		http.Error(
			writer,
			"upstream request failed",
			http.StatusBadGateway,
		)
		return
	}

	defer response.Body.Close()

	removeHopByHopHeaders(response.Header)

	copyHeaders(writer.Header(), response.Header)

	writer.WriteHeader(response.StatusCode)

	if _, err := io.Copy(writer, response.Body); err != nil {
		log.Printf("response copy failed: %v", err)
	}
}

func (h *Handler) handleConnect(
	writer http.ResponseWriter,
	request *http.Request,
) {
	destination := request.Host

	if destination == "" {
		http.Error(
			writer,
			"CONNECT destination is required",
			http.StatusBadRequest,
		)
		return
	}

	if !strings.Contains(destination, ":") {
		destination += ":443"
	}

	if err := h.validator.Validate(
		request.Context(),
		destination,
	); err != nil {
		log.Printf(
			"blocked CONNECT destination %q: %v",
			destination,
			err,
		)

		http.Error(
			writer,
			"destination is not allowed",
			http.StatusForbidden,
		)
		return
	}

	dialer := &net.Dialer{
		Timeout: h.connectTimeout,
	}

	upstreamConnection, err := dialer.DialContext(
		request.Context(),
		"tcp",
		destination,
	)
	if err != nil {
		log.Printf(
			"CONNECT dial failed for %s: %v",
			destination,
			err,
		)

		http.Error(
			writer,
			"unable to reach destination",
			http.StatusBadGateway,
		)
		return
	}

	hijacker, ok := writer.(http.Hijacker)
	if !ok {
		upstreamConnection.Close()

		http.Error(
			writer,
			"connection hijacking is unsupported",
			http.StatusInternalServerError,
		)
		return
	}

	clientConnection, bufferedWriter, err := hijacker.Hijack()
	if err != nil {
		upstreamConnection.Close()

		http.Error(
			writer,
			"failed to establish tunnel",
			http.StatusInternalServerError,
		)
		return
	}

	if _, err := bufferedWriter.WriteString(
		"HTTP/1.1 200 Connection Established\r\n\r\n",
	); err != nil {
		clientConnection.Close()
		upstreamConnection.Close()
		return
	}

	if err := bufferedWriter.Flush(); err != nil {
		clientConnection.Close()
		upstreamConnection.Close()
		return
	}

	log.Printf(
		"CONNECT tunnel established to %s",
		destination,
	)

	tunnel(clientConnection, upstreamConnection)
}

func tunnel(client net.Conn, upstream net.Conn) {
	defer client.Close()
	defer upstream.Close()

	done := make(chan struct{}, 2)

	copyConnection := func(destination, source net.Conn) {
		_, err := io.Copy(destination, source)

		if err != nil && !isExpectedNetworkError(err) {
			log.Printf("tunnel copy error: %v", err)
		}

		if tcpConnection, ok := destination.(*net.TCPConn); ok {
			_ = tcpConnection.CloseWrite()
		}

		done <- struct{}{}
	}

	go copyConnection(upstream, client)
	go copyConnection(client, upstream)

	<-done
}

func removeIdentityHeaders(headers http.Header) {
	headers.Del("Forwarded")
	headers.Del("Via")
	headers.Del("X-Forwarded-For")
	headers.Del("X-Forwarded-Host")
	headers.Del("X-Forwarded-Proto")
	headers.Del("X-Real-IP")
}

func removeHopByHopHeaders(headers http.Header) {
	connectionHeaders := headers.Values("Connection")

	for _, value := range connectionHeaders {
		for item := range strings.SplitSeq(value, ",") {
			headers.Del(strings.TrimSpace(item))
		}
	}

	hopByHopHeaders := []string{
		"Connection",
		"Keep-Alive",
		"Proxy-Authenticate",
		"Proxy-Authorization",
		"Proxy-Connection",
		"TE",
		"Trailer",
		"Transfer-Encoding",
		"Upgrade",
	}

	for _, header := range hopByHopHeaders {
		headers.Del(header)
	}
}

func copyHeaders(destination, source http.Header) {
	for key, values := range source {
		for _, value := range values {
			destination.Add(key, value)
		}
	}
}

func isExpectedNetworkError(err error) bool {
	if err == nil {
		return true
	}

	if errors.Is(err, net.ErrClosed) ||
		errors.Is(err, io.EOF) {
		return true
	}

	var operationError *net.OpError

	return errors.As(err, &operationError) &&
		operationError.Timeout()
}
