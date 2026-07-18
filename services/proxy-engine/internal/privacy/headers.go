package privacy

import (
	"net/http"
	"net/textproto"
	"strings"
)

var requestHeadersToStrip = []string{
	"Connection",
	"Proxy-Connection",
	"Keep-Alive",
	"Proxy-Authenticate",
	"Proxy-Authorization",
	"Te",
	"Trailer",
	"Transfer-Encoding",
	"Upgrade",

	"Forwarded",
	"Via",

	"X-Forwarded-For",
	"X-Forwarded-Host",
	"X-Forwarded-Proto",

	"X-Real-Ip",
	"Client-Ip",
	"X-Client-Ip",
	"True-Client-Ip",

	"Cf-Connecting-Ip",
	"Fastly-Client-Ip",

	"X-Cluster-Client-Ip",
	"X-Originating-Ip",
	"X-Original-Forwarded-For",
	"X-Proxyuser-Ip",
}

var responseHeadersToStrip = []string{
	"Connection",
	"Proxy-Connection",
	"Keep-Alive",
	"Proxy-Authenticate",
	"Proxy-Authorization",
	"Te",
	"Trailer",
	"Transfer-Encoding",
	"Upgrade",
	"Via",

	// Prevent origins from advertising
	// an alternate route that may bypass
	// the configured HTTP proxy.
	"Alt-Svc",
}

func SanitizeRequestHeaders(
	headers http.Header,
) {
	removeConnectionHeaders(
		headers,
	)

	for _, headerName := range requestHeadersToStrip {
		headers.Del(headerName)
	}
}

func SanitizeResponseHeaders(
	headers http.Header,
) {
	removeConnectionHeaders(
		headers,
	)

	for _, headerName := range responseHeadersToStrip {
		headers.Del(headerName)
	}
}

func PrepareOutboundRequest(
	request *http.Request,
) {
	request.RequestURI = ""
	request.Close = false

	SanitizeRequestHeaders(
		request.Header,
	)
}

func removeConnectionHeaders(
	headers http.Header,
) {
	for _, rawValue := range headers.Values(
		"Connection",
	) {
		for _, value := range strings.Split(
			rawValue,
			",",
		) {
			value =
				textproto.TrimString(
					value,
				)

			if value != "" {
				headers.Del(value)
			}
		}
	}
}
