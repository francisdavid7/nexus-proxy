package auth

import (
	"crypto/subtle"
	"encoding/base64"
	"net/http"
	"strings"
)

type BasicAuthenticator struct {
	username string
	password string
}

func NewBasicAuthenticator(
	username string,
	password string,
) *BasicAuthenticator {
	return &BasicAuthenticator{
		username: username,
		password: password,
	}
}

func (a *BasicAuthenticator) Authenticate(request *http.Request) bool {
	header := request.Header.Get("Proxy-Authorization")

	const prefix = "Basic "

	if !strings.HasPrefix(header, prefix) {
		return false
	}

	encodedCredentials := strings.TrimPrefix(header, prefix)

	decodedCredentials, err := base64.StdEncoding.DecodeString(
		encodedCredentials,
	)
	if err != nil {
		return false
	}

	username, password, found := strings.Cut(
		string(decodedCredentials),
		":",
	)
	if !found {
		return false
	}

	usernameMatches := subtle.ConstantTimeCompare(
		[]byte(username),
		[]byte(a.username),
	)

	passwordMatches := subtle.ConstantTimeCompare(
		[]byte(password),
		[]byte(a.password),
	)

	return usernameMatches == 1 && passwordMatches == 1
}
