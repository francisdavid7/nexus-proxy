package proxy

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/auth"
	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/ratelimit"
	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/usage"
)

type Handler struct {
	logger         *slog.Logger
	authenticator  *auth.Authenticator
	usageRecorder  *usage.PostgresRecorder
	rateLimiter    *ratelimit.RedisLimiter
	validator      *DestinationValidator
	transport      *http.Transport
	connectTimeout time.Duration
}

type countingReadCloser struct {
	io.ReadCloser
	bytesRead int64
}

func (c *countingReadCloser) Read(
	buffer []byte,
) (int, error) {
	count, err := c.ReadCloser.Read(buffer)

	c.bytesRead += int64(count)

	return count, err
}

type tunnelResult struct {
	direction string
	bytes     int64
	err       error
}

func NewHandler(
	logger *slog.Logger,
	authenticator *auth.Authenticator,
	usageRecorder *usage.PostgresRecorder,
	rateLimiter *ratelimit.RedisLimiter,
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
		usageRecorder:  usageRecorder,
		rateLimiter:    rateLimiter,
		validator:      validator,
		transport:      transport,
		connectTimeout: connectTimeout,
	}
}

func (h *Handler) ServeHTTP(
	writer http.ResponseWriter,
	request *http.Request,
) {
	protocol := auth.ProtocolHTTP

	if request.Method == http.MethodConnect {
		protocol = auth.ProtocolHTTPS
	}

	principal, err := h.authenticator.Authenticate(
		request.Context(),
		request,
		protocol,
	)

	if err != nil {
		h.logger.Warn(
			"proxy authentication failed",
			slog.String(
				"remote_address",
				request.RemoteAddr,
			),
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

	decision, err := h.rateLimiter.Allow(
		request.Context(),
		principal.CredentialID,
		principal.ConnectionsPerMinute,
	)

	if err != nil {
		h.logger.Error(
			"connection rate limiter failed",
			slog.String("error", err.Error()),
		)

		http.Error(
			writer,
			"proxy admission service unavailable",
			http.StatusServiceUnavailable,
		)

		return
	}

	if !decision.Allowed {
		writer.Header().Set(
			"Retry-After",
			strconv.FormatInt(
				int64(decision.RetryAfter.Seconds()),
				10,
			),
		)

		http.Error(
			writer,
			"proxy connection rate limit exceeded",
			http.StatusTooManyRequests,
		)

		return
	}

	if request.Method == http.MethodConnect {
		h.handleConnect(
			writer,
			request,
			principal,
		)

		return
	}

	h.handleHTTP(
		writer,
		request,
		principal,
	)
}

func (h *Handler) handleHTTP(
	writer http.ResponseWriter,
	request *http.Request,
	principal auth.Principal,
) {
	if request.URL == nil ||
		request.URL.Host == "" {
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
		h.logger.Warn(
			"blocked HTTP destination",
			slog.String(
				"destination",
				request.URL.Host,
			),
			slog.String("reason", err.Error()),
			slog.String(
				"credential_id",
				principal.CredentialID,
			),
		)

		http.Error(
			writer,
			"destination is not allowed",
			http.StatusForbidden,
		)

		return
	}

	sessionID, err :=
		h.usageRecorder.StartSession(
			request.Context(),
			principal,
			auth.ProtocolHTTP,
		)

	if err != nil {
		h.logger.Error(
			"failed to start HTTP session",
			slog.String("error", err.Error()),
		)

		http.Error(
			writer,
			"proxy accounting unavailable",
			http.StatusServiceUnavailable,
		)

		return
	}

	var requestCounter *countingReadCloser

	outboundRequest :=
		request.Clone(request.Context())

	outboundRequest.RequestURI = ""
	outboundRequest.Close = false

	if request.Body != nil {
		requestCounter = &countingReadCloser{
			ReadCloser: request.Body,
		}

		outboundRequest.Body = requestCounter
	}

	removeHopByHopHeaders(
		outboundRequest.Header,
	)

	removeIdentityHeaders(
		outboundRequest.Header,
	)

	response, err :=
		h.transport.RoundTrip(outboundRequest)

	if err != nil {
		h.finishSession(
			sessionID,
			bytesFromCounter(requestCounter),
			0,
			usage.SessionFailed,
		)

		h.logger.Error(
			"HTTP forwarding failed",
			slog.String(
				"url",
				request.URL.String(),
			),
			slog.String("error", err.Error()),
			slog.String(
				"credential_id",
				principal.CredentialID,
			),
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

	bytesDownloaded, copyError := io.Copy(
		writer,
		response.Body,
	)

	status := usage.SessionClosed

	if copyError != nil {
		status = usage.SessionFailed

		h.logger.Error(
			"HTTP response copy failed",
			slog.String(
				"error",
				copyError.Error(),
			),
			slog.String(
				"credential_id",
				principal.CredentialID,
			),
		)
	}

	h.finishSession(
		sessionID,
		bytesFromCounter(requestCounter),
		bytesDownloaded,
		status,
	)

	h.logger.Info(
		"HTTP request completed",
		slog.String("session_id", sessionID),
		slog.String("method", request.Method),
		slog.String(
			"destination",
			request.URL.Host,
		),
		slog.Int(
			"status_code",
			response.StatusCode,
		),
		slog.Int64(
			"bytes_uploaded",
			bytesFromCounter(requestCounter),
		),
		slog.Int64(
			"bytes_downloaded",
			bytesDownloaded,
		),
		slog.String(
			"credential_id",
			principal.CredentialID,
		),
	)
}

func (h *Handler) handleConnect(
	writer http.ResponseWriter,
	request *http.Request,
	principal auth.Principal,
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
		h.logger.Warn(
			"blocked CONNECT destination",
			slog.String(
				"destination",
				destination,
			),
			slog.String("reason", err.Error()),
			slog.String(
				"credential_id",
				principal.CredentialID,
			),
		)

		http.Error(
			writer,
			"destination is not allowed",
			http.StatusForbidden,
		)

		return
	}

	sessionID, err :=
		h.usageRecorder.StartSession(
			request.Context(),
			principal,
			auth.ProtocolHTTPS,
		)

	if err != nil {
		h.logger.Error(
			"failed to start CONNECT session",
			slog.String("error", err.Error()),
		)

		http.Error(
			writer,
			"proxy accounting unavailable",
			http.StatusServiceUnavailable,
		)

		return
	}

	dialer := &net.Dialer{
		Timeout: h.connectTimeout,
	}

	upstreamConnection, err :=
		dialer.DialContext(
			request.Context(),
			"tcp",
			destination,
		)

	if err != nil {
		h.finishSession(
			sessionID,
			0,
			0,
			usage.SessionFailed,
		)

		h.logger.Error(
			"CONNECT dial failed",
			slog.String(
				"destination",
				destination,
			),
			slog.String("error", err.Error()),
			slog.String(
				"credential_id",
				principal.CredentialID,
			),
		)

		http.Error(
			writer,
			"unable to reach destination",
			http.StatusBadGateway,
		)

		return
	}

	hijacker, ok :=
		writer.(http.Hijacker)

	if !ok {
		_ = upstreamConnection.Close()

		h.finishSession(
			sessionID,
			0,
			0,
			usage.SessionFailed,
		)

		http.Error(
			writer,
			"connection hijacking is unsupported",
			http.StatusInternalServerError,
		)

		return
	}

	clientConnection, bufferedWriter, err :=
		hijacker.Hijack()

	if err != nil {
		_ = upstreamConnection.Close()

		h.finishSession(
			sessionID,
			0,
			0,
			usage.SessionFailed,
		)

		return
	}

	if _, err := bufferedWriter.WriteString(
		"HTTP/1.1 200 Connection Established\r\n\r\n",
	); err != nil {
		_ = clientConnection.Close()
		_ = upstreamConnection.Close()

		h.finishSession(
			sessionID,
			0,
			0,
			usage.SessionFailed,
		)

		return
	}

	if err := bufferedWriter.Flush(); err != nil {
		_ = clientConnection.Close()
		_ = upstreamConnection.Close()

		h.finishSession(
			sessionID,
			0,
			0,
			usage.SessionFailed,
		)

		return
	}

	h.logger.Info(
		"CONNECT tunnel established",
		slog.String("session_id", sessionID),
		slog.String(
			"destination",
			destination,
		),
		slog.String(
			"credential_id",
			principal.CredentialID,
		),
	)

	bytesUploaded, bytesDownloaded :=
		tunnel(
			h.logger,
			clientConnection,
			upstreamConnection,
			destination,
			sessionID,
		)

	h.finishSession(
		sessionID,
		bytesUploaded,
		bytesDownloaded,
		usage.SessionClosed,
	)

	h.logger.Info(
		"CONNECT tunnel completed",
		slog.String("session_id", sessionID),
		slog.String(
			"destination",
			destination,
		),
		slog.Int64(
			"bytes_uploaded",
			bytesUploaded,
		),
		slog.Int64(
			"bytes_downloaded",
			bytesDownloaded,
		),
	)
}

func tunnel(
	logger *slog.Logger,
	client net.Conn,
	upstream net.Conn,
	destination string,
	sessionID string,
) (int64, int64) {
	defer client.Close()
	defer upstream.Close()

	results := make(chan tunnelResult, 2)

	copyConnection := func(
		direction string,
		destinationConnection net.Conn,
		sourceConnection net.Conn,
	) {
		bytesCopied, err := io.Copy(
			destinationConnection,
			sourceConnection,
		)

		if tcpConnection, ok :=
			destinationConnection.(*net.TCPConn); ok {
			_ = tcpConnection.CloseWrite()
		}

		results <- tunnelResult{
			direction: direction,
			bytes:     bytesCopied,
			err:       err,
		}
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

	var bytesUploaded int64
	var bytesDownloaded int64

	for range 2 {
		result := <-results

		if result.err != nil &&
			!isExpectedNetworkError(result.err) {
			logger.Error(
				"tunnel copy failed",
				slog.String(
					"session_id",
					sessionID,
				),
				slog.String(
					"direction",
					result.direction,
				),
				slog.String(
					"destination",
					destination,
				),
				slog.String(
					"error",
					result.err.Error(),
				),
			)
		}

		switch result.direction {
		case "client_to_upstream":
			bytesUploaded = result.bytes

		case "upstream_to_client":
			bytesDownloaded = result.bytes
		}
	}

	return bytesUploaded, bytesDownloaded
}

func (h *Handler) finishSession(
	sessionID string,
	bytesUploaded int64,
	bytesDownloaded int64,
	status usage.SessionStatus,
) {
	accountingContext, cancel :=
		context.WithTimeout(
			context.Background(),
			5*time.Second,
		)

	defer cancel()

	if err := h.usageRecorder.FinishSession(
		accountingContext,
		sessionID,
		bytesUploaded,
		bytesDownloaded,
		status,
	); err != nil {
		h.logger.Error(
			"failed to finish connection session",
			slog.String("session_id", sessionID),
			slog.String("error", err.Error()),
		)
	}
}

func bytesFromCounter(
	counter *countingReadCloser,
) int64 {
	if counter == nil {
		return 0
	}

	return counter.bytesRead
}

func removeIdentityHeaders(
	headers http.Header,
) {
	headers.Del("Forwarded")
	headers.Del("Via")
	headers.Del("X-Forwarded-For")
	headers.Del("X-Forwarded-Host")
	headers.Del("X-Forwarded-Proto")
	headers.Del("X-Real-IP")
}

func removeHopByHopHeaders(
	headers http.Header,
) {
	connectionHeaders :=
		headers.Values("Connection")

	for _, value := range connectionHeaders {
		for item := range strings.SplitSeq(
			value,
			",",
		) {
			headers.Del(
				strings.TrimSpace(item),
			)
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

func isExpectedNetworkError(
	err error,
) bool {
	if err == nil {
		return true
	}

	if errors.Is(err, net.ErrClosed) ||
		errors.Is(err, io.EOF) {
		return true
	}

	var operationError *net.OpError

	return errors.As(
		err,
		&operationError,
	) && operationError.Timeout()
}
