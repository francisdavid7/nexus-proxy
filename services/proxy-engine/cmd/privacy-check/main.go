package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	publicIPURL     = "https://api.ipify.org?format=json"
	httpTestURL     = "http://example.com/"
	httpsTestURL    = "https://example.com/"
	headerTestURL   = "http://httpbingo.org/headers"
	httpsHeadersURL = "https://postman-echo.com/headers"

	requestTimeout = 25 * time.Second
)

type publicIPResponse struct {
	IP string `json:"ip"`
}

type headersResponse struct {
	Headers map[string]any `json:"headers"`
}

type checkResult struct {
	Name    string
	Detail  string
	Passed  bool
	Warning bool
}

type verifier struct {
	results []checkResult
}

func main() {
	proxyAddress := firstNonEmpty(
		os.Getenv("PROXY_ADDRESS"),
		os.Getenv("PROXY_URL"),
	)

	proxyUsername :=
		strings.TrimSpace(
			os.Getenv("PROXY_USERNAME"),
		)

	proxySecret :=
		os.Getenv("PROXY_SECRET")

	if proxyAddress == "" {
		exitConfigurationError(
			"PROXY_ADDRESS is required",
		)
	}

	if proxyUsername == "" {
		exitConfigurationError(
			"PROXY_USERNAME is required",
		)
	}

	if proxySecret == "" {
		exitConfigurationError(
			"PROXY_SECRET is required",
		)
	}

	requireExitIPChange :=
		parseBooleanEnvironment(
			"REQUIRE_EXIT_IP_CHANGE",
			false,
		)

	proxyURL, err :=
		url.Parse(proxyAddress)

	if err != nil {
		exitConfigurationError(
			fmt.Sprintf(
				"invalid PROXY_ADDRESS: %v",
				err,
			),
		)
	}

	if proxyURL.Scheme != "http" &&
		proxyURL.Scheme != "https" {
		exitConfigurationError(
			"PROXY_ADDRESS must use http:// or https://",
		)
	}

	if proxyURL.Host == "" {
		exitConfigurationError(
			"PROXY_ADDRESS must include a hostname and port",
		)
	}

	proxyURL.User =
		url.UserPassword(
			proxyUsername,
			proxySecret,
		)

	directClient :=
		newHTTPClient(nil)

	proxiedClient :=
		newHTTPClient(proxyURL)

	invalidProxyURL := cloneURL(
		proxyURL,
	)

	invalidProxyURL.User =
		url.UserPassword(
			proxyUsername,
			proxySecret+"-invalid",
		)

	invalidCredentialClient :=
		newHTTPClient(
			invalidProxyURL,
		)

	checker := &verifier{}

	fmt.Println()
	fmt.Println(
		"Nexus Proxy Privacy Verification",
	)

	fmt.Println(
		"================================",
	)

	fmt.Printf(
		"Proxy endpoint: %s://%s\n",
		proxyURL.Scheme,
		proxyURL.Host,
	)

	fmt.Printf(
		"Proxy username: %s\n\n",
		proxyUsername,
	)

	checker.verifyPublicIPs(
		directClient,
		proxiedClient,
		requireExitIPChange,
	)

	checker.verifySuccessfulRequest(
		"Authenticated HTTP forwarding",
		proxiedClient,
		httpTestURL,
	)

	checker.verifySuccessfulRequest(
		"Authenticated HTTPS CONNECT",
		proxiedClient,
		httpsTestURL,
	)

	checker.verifyInvalidCredentials(
		invalidCredentialClient,
	)

	checker.verifyHTTPHeaderSanitation(
		proxiedClient,
	)

	checker.verifyHTTPSCredentialIsolation(
		proxiedClient,
	)

	checker.verifyBlockedDestination(
		"Loopback destination blocking",
		proxiedClient,
		"http://127.0.0.1/",
	)

	checker.verifyBlockedDestination(
		"Cloud metadata destination blocking",
		proxiedClient,
		"http://169.254.169.254/latest/meta-data/",
	)

	checker.verifyBlockedDestination(
		"Destination-port policy",
		proxiedClient,
		"http://example.com:22/",
	)

	checker.printSummary()
}

func newHTTPClient(
	proxyURL *url.URL,
) *http.Client {
	transport := &http.Transport{
		Proxy: nil,

		ForceAttemptHTTP2: true,

		MaxIdleConns: 20,

		MaxIdleConnsPerHost: 5,

		IdleConnTimeout: 30 * time.Second,

		TLSHandshakeTimeout: 10 * time.Second,

		ResponseHeaderTimeout: 15 * time.Second,

		ExpectContinueTimeout: time.Second,
	}

	if proxyURL != nil {
		transport.Proxy =
			http.ProxyURL(
				proxyURL,
			)
	}

	return &http.Client{
		Transport: transport,

		Timeout: requestTimeout,

		CheckRedirect: func(
			_ *http.Request,
			_ []*http.Request,
		) error {
			return http.ErrUseLastResponse
		},
	}
}

func (
	verifier *verifier,
) verifyPublicIPs(
	directClient *http.Client,
	proxiedClient *http.Client,
	requireChange bool,
) {
	directIP, err :=
		readPublicIP(
			directClient,
		)

	if err != nil {
		verifier.fail(
			"Direct public-IP lookup",
			err.Error(),
		)

		return
	}

	verifier.pass(
		"Direct public-IP lookup",
		directIP,
	)

	proxyIP, err :=
		readPublicIP(
			proxiedClient,
		)

	if err != nil {
		verifier.fail(
			"Proxy exit-IP lookup",
			err.Error(),
		)

		return
	}

	verifier.pass(
		"Proxy exit-IP lookup",
		proxyIP,
	)

	if directIP != proxyIP {
		verifier.pass(
			"Exit-IP replacement",
			fmt.Sprintf(
				"direct=%s, proxy=%s",
				directIP,
				proxyIP,
			),
		)

		return
	}

	detail := fmt.Sprintf(
		"direct and proxy IP are both %s; "+
			"this is expected when the proxy node runs "+
			"behind the same local internet connection",
		directIP,
	)

	if requireChange {
		verifier.fail(
			"Exit-IP replacement",
			detail,
		)

		return
	}

	verifier.warn(
		"Exit-IP replacement",
		detail,
	)
}

func (
	verifier *verifier,
) verifySuccessfulRequest(
	name string,
	client *http.Client,
	target string,
) {
	status, _, err :=
		performRequest(
			client,
			target,
			nil,
		)

	if err != nil {
		verifier.fail(
			name,
			err.Error(),
		)

		return
	}

	if status < 200 ||
		status >= 400 {
		verifier.fail(
			name,
			fmt.Sprintf(
				"unexpected HTTP status %d",
				status,
			),
		)

		return
	}

	verifier.pass(
		name,
		fmt.Sprintf(
			"HTTP %d",
			status,
		),
	)
}

func (
	verifier *verifier,
) verifyInvalidCredentials(
	client *http.Client,
) {
	status, _, err :=
		performRequest(
			client,
			httpTestURL,
			nil,
		)

	if err != nil {
		verifier.fail(
			"Invalid credential rejection",
			err.Error(),
		)

		return
	}

	if status !=
		http.StatusProxyAuthRequired {
		verifier.fail(
			"Invalid credential rejection",
			fmt.Sprintf(
				"expected HTTP 407, received HTTP %d",
				status,
			),
		)

		return
	}

	verifier.pass(
		"Invalid credential rejection",
		"HTTP 407",
	)
}

func (
	verifier *verifier,
) verifyHTTPHeaderSanitation(
	client *http.Client,
) {
	const sentinel = "nexus-original-client-leak-198.51.100.77"

	injectedHeaders :=
		map[string]string{
			"Forwarded": "for=" + sentinel,

			"X-Forwarded-For": sentinel,

			"X-Forwarded-Host": sentinel,

			"X-Forwarded-Proto": sentinel,

			"X-Real-IP": sentinel,

			"Client-IP": sentinel,

			"X-Client-IP": sentinel,

			"True-Client-IP": sentinel,

			"Via": sentinel,

			"CF-Connecting-IP": sentinel,

			"Fastly-Client-IP": sentinel,

			"X-Originating-IP": sentinel,

			"X-Original-Forwarded-For": sentinel,

			"Connection": "X-Nexus-Connection-Secret",

			"X-Nexus-Connection-Secret": sentinel,
		}

	status, body, err :=
		performRequest(
			client,
			headerTestURL,
			injectedHeaders,
		)

	if err != nil {
		verifier.fail(
			"HTTP identifying-header sanitation",
			err.Error(),
		)

		return
	}

	if status != http.StatusOK {
		verifier.fail(
			"HTTP identifying-header sanitation",
			fmt.Sprintf(
				"header service returned HTTP %d",
				status,
			),
		)

		return
	}

	var payload headersResponse

	if err := json.Unmarshal(
		body,
		&payload,
	); err != nil {
		verifier.fail(
			"HTTP identifying-header sanitation",
			fmt.Sprintf(
				"invalid header response: %v",
				err,
			),
		)

		return
	}

	for headerName, value := range payload.Headers {
		if strings.Contains(fmt.Sprint(value), sentinel) {
			verifier.fail(
				"HTTP identifying-header sanitation",
				fmt.Sprintf(
					"sentinel leaked through header %s",
					headerName,
				),
			)

			return
		}
	}

	if containsHeader(
		payload.Headers,
		"Proxy-Authorization",
	) {
		verifier.fail(
			"Proxy credential isolation over HTTP",
			"origin received Proxy-Authorization",
		)

		return
	}

	verifier.pass(
		"HTTP identifying-header sanitation",
		"all injected identity sentinels removed",
	)

	verifier.pass(
		"Proxy credential isolation over HTTP",
		"Proxy-Authorization absent at origin",
	)
}

func (
	verifier *verifier,
) verifyHTTPSCredentialIsolation(
	client *http.Client,
) {
	status, body, err :=
		performRequest(
			client,
			httpsHeadersURL,
			nil,
		)

	if err != nil {
		verifier.fail(
			"Proxy credential isolation through CONNECT",
			err.Error(),
		)

		return
	}

	if status != http.StatusOK {
		verifier.fail(
			"Proxy credential isolation through CONNECT",
			fmt.Sprintf(
				"header service returned HTTP %d",
				status,
			),
		)

		return
	}

	var payload headersResponse

	if err := json.Unmarshal(
		body,
		&payload,
	); err != nil {
		verifier.fail(
			"Proxy credential isolation through CONNECT",
			fmt.Sprintf(
				"invalid header response: %v",
				err,
			),
		)

		return
	}

	if containsHeader(
		payload.Headers,
		"Proxy-Authorization",
	) {
		verifier.fail(
			"Proxy credential isolation through CONNECT",
			"origin received Proxy-Authorization",
		)

		return
	}

	verifier.pass(
		"Proxy credential isolation through CONNECT",
		"Proxy-Authorization absent at HTTPS origin",
	)
}

func (
	verifier *verifier,
) verifyBlockedDestination(
	name string,
	client *http.Client,
	target string,
) {
	status, _, err :=
		performRequest(
			client,
			target,
			nil,
		)

	if err != nil {
		verifier.fail(
			name,
			err.Error(),
		)

		return
	}

	if status != http.StatusForbidden {
		verifier.fail(
			name,
			fmt.Sprintf(
				"expected HTTP 403, received HTTP %d",
				status,
			),
		)

		return
	}

	verifier.pass(
		name,
		"HTTP 403",
	)
}

func readPublicIP(
	client *http.Client,
) (string, error) {
	status, body, err :=
		performRequest(
			client,
			publicIPURL,
			nil,
		)

	if err != nil {
		return "", err
	}

	if status != http.StatusOK {
		return "", fmt.Errorf(
			"IP service returned HTTP %d",
			status,
		)
	}

	var payload publicIPResponse

	if err := json.Unmarshal(
		body,
		&payload,
	); err != nil {
		return "", fmt.Errorf(
			"decode public IP response: %w",
			err,
		)
	}

	payload.IP =
		strings.TrimSpace(
			payload.IP,
		)

	if payload.IP == "" {
		return "", fmt.Errorf(
			"IP service returned an empty address",
		)
	}

	return payload.IP, nil
}

func performRequest(
	client *http.Client,
	target string,
	headers map[string]string,
) (int, []byte, error) {
	ctx, cancel :=
		context.WithTimeout(
			context.Background(),
			requestTimeout,
		)

	defer cancel()

	request, err :=
		http.NewRequestWithContext(
			ctx,
			http.MethodGet,
			target,
			nil,
		)

	if err != nil {
		return 0, nil, err
	}

	for name, value := range headers {
		request.Header.Set(
			name,
			value,
		)
	}

	response, err :=
		client.Do(request)

	if err != nil {
		return 0, nil, err
	}

	defer response.Body.Close()

	body, err :=
		io.ReadAll(
			io.LimitReader(
				response.Body,
				2<<20,
			),
		)

	if err != nil {
		return response.StatusCode,
			nil,
			err
	}

	return response.StatusCode,
		body,
		nil
}

func containsHeader(
	headers map[string]any,
	expectedName string,
) bool {
	for headerName := range headers {
		if strings.EqualFold(
			headerName,
			expectedName,
		) {
			return true
		}
	}

	return false
}

func cloneURL(
	source *url.URL,
) *url.URL {
	clone := *source

	return &clone
}

func firstNonEmpty(
	values ...string,
) string {
	for _, value := range values {
		value =
			strings.TrimSpace(
				value,
			)

		if value != "" {
			return value
		}
	}

	return ""
}

func parseBooleanEnvironment(
	key string,
	fallback bool,
) bool {
	value :=
		strings.TrimSpace(
			os.Getenv(key),
		)

	if value == "" {
		return fallback
	}

	parsed, err :=
		strconv.ParseBool(value)

	if err != nil {
		return fallback
	}

	return parsed
}

func exitConfigurationError(
	message string,
) {
	fmt.Fprintf(
		os.Stderr,
		"Configuration error: %s\n",
		message,
	)

	os.Exit(2)
}

func (
	verifier *verifier,
) pass(
	name string,
	detail string,
) {
	verifier.results =
		append(
			verifier.results,
			checkResult{
				Name: name,

				Detail: detail,

				Passed: true,
			},
		)

	fmt.Printf(
		"[PASS] %s — %s\n",
		name,
		detail,
	)
}

func (
	verifier *verifier,
) warn(
	name string,
	detail string,
) {
	verifier.results =
		append(
			verifier.results,
			checkResult{
				Name: name,

				Detail: detail,

				Warning: true,
			},
		)

	fmt.Printf(
		"[WARN] %s — %s\n",
		name,
		detail,
	)
}

func (
	verifier *verifier,
) fail(
	name string,
	detail string,
) {
	verifier.results =
		append(
			verifier.results,
			checkResult{
				Name: name,

				Detail: detail,
			},
		)

	fmt.Printf(
		"[FAIL] %s — %s\n",
		name,
		detail,
	)
}

func (
	verifier *verifier,
) printSummary() {
	passed := 0
	warnings := 0
	failed := 0

	for _, result := range verifier.results {
		switch {
		case result.Passed:
			passed++

		case result.Warning:
			warnings++

		default:
			failed++
		}
	}

	fmt.Println()
	fmt.Println(
		"Verification Summary",
	)

	fmt.Println(
		"--------------------",
	)

	fmt.Printf(
		"Passed:   %d\n",
		passed,
	)

	fmt.Printf(
		"Warnings: %d\n",
		warnings,
	)

	fmt.Printf(
		"Failed:   %d\n",
		failed,
	)

	if failed > 0 {
		fmt.Println()
		fmt.Println(
			"PRIVACY VERIFICATION FAILED",
		)

		os.Exit(1)
	}

	fmt.Println()
	fmt.Println(
		"PRIVACY VERIFICATION PASSED",
	)
}
