package proxy

import (
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/auth"
)

type Handler struct {
	logger         *slog.Logger
	authenticator  *auth.BasicAuthenticator
	validator      *DestinationValidator
	transport      *http.Transport
	connectTimeout time.Duration
}

func NewHandler(
	logger *slog.Logger,
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
		logger:         logger,
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
		h.logger.Warn(
			"proxy authentication failed",
			slog.String("remote_address", request.RemoteAddr),
			slog.String("method", request.Method),
		)

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
		h.logger.Warn(
			"HTTP request missing absolute destination",
			slog.String("remote_address", request.RemoteAddr),
		)

		http.Error(
			writer,
			"absolute destination URL is required",
			http.StatusBadRequest,
		)

		return
	}

	if request.URL.Scheme != "http" {
		h.logger.Warn(
			"unsupported HTTP URL scheme",
			slog.String("scheme", request.URL.Scheme),
			slog.String("destination", request.URL.Host),
		)

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
		h.logger.Warn(
			"blocked HTTP destination",
			slog.String("destination", request.URL.Host),
			slog.String("reason", err.Error()),
			slog.String("remote_address", request.RemoteAddr),
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
		h.logger.Error(
			"HTTP forwarding failed",
			slog.String("url", request.URL.String()),
			slog.String("error", err.Error()),
			slog.String("remote_address", request.RemoteAddr),
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
		h.logger.Error(
			"HTTP response copy failed",
			slog.String("url", request.URL.String()),
			slog.String("error", err.Error()),
		)

		return
	}

	h.logger.Info(
		"HTTP request forwarded",
		slog.String("method", request.Method),
		slog.String("destination", request.URL.Host),
		slog.Int("status_code", response.StatusCode),
		slog.String("remote_address", request.RemoteAddr),
	)
}

func (h *Handler) handleConnect(
	writer http.ResponseWriter,
	request *http.Request,
) {
	destination := request.Host

	if destination == "" {
		h.logger.Warn(
			"CONNECT request missing destination",
			slog.String("remote_address", request.RemoteAddr),
		)

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
		h.logger.Warn(
			"blocked CONNECT destination",
			slog.String("destination", destination),
			slog.String("reason", err.Error()),
			slog.String("remote_address", request.RemoteAddr),
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
		h.logger.Error(
			"CONNECT dial failed",
			slog.String("destination", destination),
			slog.String("error", err.Error()),
			slog.String("remote_address", request.RemoteAddr),
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
		_ = upstreamConnection.Close()

		h.logger.Error(
			"connection hijacking unsupported",
			slog.String("destination", destination),
		)

		http.Error(
			writer,
			"connection hijacking is unsupported",
			http.StatusInternalServerError,
		)

		return
	}

	clientConnection, bufferedWriter, err := hijacker.Hijack()
	if err != nil {
		_ = upstreamConnection.Close()

		h.logger.Error(
			"failed to hijack client connection",
			slog.String("destination", destination),
			slog.String("error", err.Error()),
		)

		return
	}

	if _, err := bufferedWriter.WriteString(
		"HTTP/1.1 200 Connection Established\r\n\r\n",
	); err != nil {
		h.logger.Error(
			"failed to write CONNECT response",
			slog.String("destination", destination),
			slog.String("error", err.Error()),
		)

		_ = clientConnection.Close()
		_ = upstreamConnection.Close()

		return
	}

	if err := bufferedWriter.Flush(); err != nil {
		h.logger.Error(
			"failed to flush CONNECT response",
			slog.String("destination", destination),
			slog.String("error", err.Error()),
		)

		_ = clientConnection.Close()
		_ = upstreamConnection.Close()

		return
	}

	h.logger.Info(
		"CONNECT tunnel established",
		slog.String("destination", destination),
		slog.String("remote_address", request.RemoteAddr),
	)

	tunnel(
		h.logger,
		clientConnection,
		upstreamConnection,
		destination,
	)
}

func tunnel(
	logger *slog.Logger,
	client net.Conn,
	upstream net.Conn,
	destination string,
) {
	defer client.Close()
	defer upstream.Close()

	done := make(chan struct{}, 2)

	copyConnection := func(
		connectionName string,
		destinationConnection net.Conn,
		sourceConnection net.Conn,
	) {
		_, err := io.Copy(
			destinationConnection,
			sourceConnection,
		)

		if err != nil && !isExpectedNetworkError(err) {
			logger.Error(
				"tunnel copy failed",
				slog.String("direction", connectionName),
				slog.String("destination", destination),
				slog.String("error", err.Error()),
			)
		}

		if tcpConnection, ok := destinationConnection.(*net.TCPConn); ok {
			_ = tcpConnection.CloseWrite()
		}

		done <- struct{}{}
	}

	go copyConnection(
		"client_to_upstream",
		upstream,
		client,
	)

	go copyConnection(
		"upstream_to_client",
		client,
		upstream,
	)

	<-done

	logger.Info(
		"CONNECT tunnel closed",
		slog.String("destination", destination),
	)
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

func copyHeaders(
	destination http.Header,
	source http.Header,
) {
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
