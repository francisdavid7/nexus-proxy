package privacy

import (
	"net/http"
	"time"
)

type SanitizingRoundTripper struct {
	Base http.RoundTripper
}

func NewTransport(
	guard *Guard,
) *http.Transport {
	return &http.Transport{
		Proxy: nil,

		DialContext: guard.DialContext,

		ForceAttemptHTTP2: true,

		MaxIdleConns: 256,

		MaxIdleConnsPerHost: 32,

		IdleConnTimeout: 90 * time.Second,

		TLSHandshakeTimeout: 10 * time.Second,

		ResponseHeaderTimeout: 30 * time.Second,

		ExpectContinueTimeout: 1 * time.Second,

		MaxResponseHeaderBytes: 1 << 20,
	}
}

func NewRoundTripper(
	guard *Guard,
) http.RoundTripper {
	return &SanitizingRoundTripper{
		Base: NewTransport(guard),
	}
}

func (
	roundTripper *SanitizingRoundTripper,
) RoundTrip(
	request *http.Request,
) (*http.Response, error) {
	base :=
		roundTripper.Base

	if base == nil {
		base =
			http.DefaultTransport
	}

	outboundRequest :=
		request.Clone(
			request.Context(),
		)

	outboundRequest.Header =
		request.Header.Clone()

	PrepareOutboundRequest(
		outboundRequest,
	)

	response, err :=
		base.RoundTrip(
			outboundRequest,
		)

	if response != nil {
		SanitizeResponseHeaders(
			response.Header,
		)
	}

	return response, err
}
