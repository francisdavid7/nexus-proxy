package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"flag"
	"fmt"
	"os"
)

type registration struct {
	KeyID          string `json:"keyId"`
	PublicKeyPEM   string `json:"publicKeyPem"`
	RevokeExisting bool   `json:"revokeExisting"`
}

func main() {
	privateKeyPath := flag.String(
		"private-key-file",
		".secrets/node-agent-private.pem",
		"path for the private key",
	)

	registrationPath := flag.String(
		"registration-file",
		".secrets/node-agent-registration.json",
		"path for the public registration JSON",
	)

	flag.Parse()

	publicKey, privateKey, err :=
		ed25519.GenerateKey(rand.Reader)
	if err != nil {
		fail("generate Ed25519 key", err)
	}

	privateDER, err :=
		x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		fail("marshal private key", err)
	}

	publicDER, err :=
		x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		fail("marshal public key", err)
	}

	privatePEM := pem.EncodeToMemory(&pem.Block{
		Type:  "PRIVATE KEY",
		Bytes: privateDER,
	})

	publicPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: publicDER,
	})

	keyIDBytes := make([]byte, 12)

	if _, err := rand.Read(keyIDBytes); err != nil {
		fail("generate key ID", err)
	}

	keyID := "nak_" +
		hex.EncodeToString(keyIDBytes)

	if err := os.WriteFile(
		*privateKeyPath,
		privatePEM,
		0o600,
	); err != nil {
		fail("write private key", err)
	}

	payload, err := json.MarshalIndent(
		registration{
			KeyID:          keyID,
			PublicKeyPEM:   string(publicPEM),
			RevokeExisting: true,
		},
		"",
		"  ",
	)
	if err != nil {
		fail("encode registration", err)
	}

	payload = append(payload, '\n')

	if err := os.WriteFile(
		*registrationPath,
		payload,
		0o600,
	); err != nil {
		fail("write registration", err)
	}

	fmt.Printf("Key ID: %s\n", keyID)
	fmt.Printf(
		"Private key: %s\n",
		*privateKeyPath,
	)
	fmt.Printf(
		"Registration JSON: %s\n",
		*registrationPath,
	)
}

func fail(action string, err error) {
	fmt.Fprintf(
		os.Stderr,
		"%s: %v\n",
		action,
		err,
	)

	os.Exit(1)
}
