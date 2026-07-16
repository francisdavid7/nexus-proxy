package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const signatureVersion = "NEXUS-NODE-V1"

type config struct {
	ControlPlaneURL string
	NodeID          string
	KeyID           string
	PrivateKeyFile  string
	Version         string
	Protocols       []string
	MaxConnections  int
	HeartbeatPeriod time.Duration
	DiskPath        string
}

type systemMetrics struct {
	CPUPercent    *float64 `json:"cpuPercent"`
	MemoryPercent *float64 `json:"memoryPercent"`
	DiskPercent   *float64 `json:"diskPercent"`
	UptimeSeconds *int64   `json:"uptimeSeconds"`
}

type heartbeatPayload struct {
	NodeID                 string        `json:"nodeId"`
	Version                string        `json:"version"`
	Protocols              []string      `json:"protocols"`
	ReportedMaxConnections int           `json:"reportedMaxConnections"`
	System                 systemMetrics `json:"system"`
}

type cpuSample struct {
	total uint64
	idle  uint64
	ready bool
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}

	privateKey, err :=
		loadPrivateKey(cfg.PrivateKeyFile)
	if err != nil {
		log.Fatal(err)
	}

	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	ctx, stop :=
		signal.NotifyContext(
			context.Background(),
			os.Interrupt,
			syscall.SIGTERM,
		)
	defer stop()

	var sampler cpuSample

	send := func() {
		metrics := collectSystemMetrics(
			&sampler,
			cfg.DiskPath,
		)

		payload := heartbeatPayload{
			NodeID:                 cfg.NodeID,
			Version:                cfg.Version,
			Protocols:              cfg.Protocols,
			ReportedMaxConnections: cfg.MaxConnections,
			System:                 metrics,
		}

		if err := sendHeartbeat(
			ctx,
			client,
			cfg,
			privateKey,
			payload,
		); err != nil {
			log.Printf(
				"heartbeat failed: %v",
				err,
			)

			return
		}

		log.Printf(
			"heartbeat accepted for node %s",
			cfg.NodeID,
		)
	}

	send()

	ticker := time.NewTicker(
		cfg.HeartbeatPeriod,
	)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Print("node agent stopped")
			return

		case <-ticker.C:
			send()
		}
	}
}

func loadConfig() (config, error) {
	heartbeatPeriod, err :=
		time.ParseDuration(
			envOrDefault(
				"HEARTBEAT_INTERVAL",
				"20s",
			),
		)
	if err != nil ||
		heartbeatPeriod < 5*time.Second {
		return config{}, errors.New(
			"HEARTBEAT_INTERVAL must be at least 5s",
		)
	}

	maxConnections, err :=
		strconv.Atoi(
			envOrDefault(
				"MAX_CONNECTIONS",
				"1000",
			),
		)
	if err != nil ||
		maxConnections < 1 {
		return config{}, errors.New(
			"MAX_CONNECTIONS must be positive",
		)
	}

	protocols, err :=
		parseProtocols(
			envOrDefault(
				"NODE_PROTOCOLS",
				"HTTP,HTTPS",
			),
		)
	if err != nil {
		return config{}, err
	}

	cfg := config{
		ControlPlaneURL: strings.TrimRight(
			os.Getenv(
				"CONTROL_PLANE_URL",
			),
			"/",
		),

		NodeID: strings.TrimSpace(
			os.Getenv("NODE_ID"),
		),

		KeyID: strings.TrimSpace(
			os.Getenv(
				"NODE_AGENT_KEY_ID",
			),
		),

		PrivateKeyFile: strings.TrimSpace(
			os.Getenv(
				"NODE_AGENT_PRIVATE_KEY_FILE",
			),
		),

		Version: envOrDefault(
			"NODE_AGENT_VERSION",
			"0.1.0",
		),

		Protocols:       protocols,
		MaxConnections:  maxConnections,
		HeartbeatPeriod: heartbeatPeriod,

		DiskPath: envOrDefault(
			"DISK_PATH",
			"/",
		),
	}

	switch {
	case cfg.ControlPlaneURL == "":
		return config{}, errors.New(
			"CONTROL_PLANE_URL is required",
		)

	case cfg.NodeID == "":
		return config{}, errors.New(
			"NODE_ID is required",
		)

	case cfg.KeyID == "":
		return config{}, errors.New(
			"NODE_AGENT_KEY_ID is required",
		)

	case cfg.PrivateKeyFile == "":
		return config{}, errors.New(
			"NODE_AGENT_PRIVATE_KEY_FILE is required",
		)
	}

	return cfg, nil
}

func parseProtocols(
	value string,
) ([]string, error) {
	seen := map[string]bool{}
	protocols := make([]string, 0, 2)

	for _, item := range strings.Split(
		value,
		",",
	) {
		protocol := strings.ToUpper(
			strings.TrimSpace(item),
		)

		if protocol == "" ||
			seen[protocol] {
			continue
		}

		if protocol != "HTTP" &&
			protocol != "HTTPS" {
			return nil, fmt.Errorf(
				"unsupported protocol %q",
				protocol,
			)
		}

		seen[protocol] = true
		protocols = append(
			protocols,
			protocol,
		)
	}

	if len(protocols) == 0 {
		return nil, errors.New(
			"NODE_PROTOCOLS is empty",
		)
	}

	return protocols, nil
}

func loadPrivateKey(
	path string,
) (ed25519.PrivateKey, error) {
	value, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf(
			"read private key: %w",
			err,
		)
	}

	block, _ := pem.Decode(value)
	if block == nil {
		return nil, errors.New(
			"private key PEM is invalid",
		)
	}

	parsed, err :=
		x509.ParsePKCS8PrivateKey(
			block.Bytes,
		)
	if err != nil {
		return nil, fmt.Errorf(
			"parse private key: %w",
			err,
		)
	}

	privateKey, valid :=
		parsed.(ed25519.PrivateKey)
	if !valid {
		return nil, errors.New(
			"private key is not Ed25519",
		)
	}

	return privateKey, nil
}

func sendHeartbeat(
	ctx context.Context,
	client *http.Client,
	cfg config,
	privateKey ed25519.PrivateKey,
	payload heartbeatPayload,
) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	endpoint :=
		cfg.ControlPlaneURL +
			"/api/node/heartbeat"

	parsedURL, err :=
		url.Parse(endpoint)
	if err != nil {
		return err
	}

	timestamp :=
		strconv.FormatInt(
			time.Now().Unix(),
			10,
		)

	nonceBytes := make([]byte, 24)

	if _, err := rand.Read(
		nonceBytes,
	); err != nil {
		return err
	}

	nonce :=
		base64.RawURLEncoding.EncodeToString(
			nonceBytes,
		)

	bodyDigest :=
		sha256.Sum256(body)

	canonical := strings.Join(
		[]string{
			signatureVersion,
			http.MethodPost,
			parsedURL.Path,
			timestamp,
			nonce,
			hex.EncodeToString(
				bodyDigest[:],
			),
		},
		"\n",
	)

	signature := ed25519.Sign(
		privateKey,
		[]byte(canonical),
	)

	request, err :=
		http.NewRequestWithContext(
			ctx,
			http.MethodPost,
			endpoint,
			bytes.NewReader(body),
		)
	if err != nil {
		return err
	}

	request.Header.Set(
		"Content-Type",
		"application/json",
	)

	request.Header.Set(
		"X-Nexus-Node-Key-ID",
		cfg.KeyID,
	)

	request.Header.Set(
		"X-Nexus-Node-Timestamp",
		timestamp,
	)

	request.Header.Set(
		"X-Nexus-Node-Nonce",
		nonce,
	)

	request.Header.Set(
		"X-Nexus-Node-Signature",
		base64.RawURLEncoding.EncodeToString(
			signature,
		),
	)

	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	responseBody, _ := io.ReadAll(
		io.LimitReader(
			response.Body,
			4096,
		),
	)

	if response.StatusCode < 200 ||
		response.StatusCode >= 300 {
		return fmt.Errorf(
			"control plane returned %s: %s",
			response.Status,
			strings.TrimSpace(
				string(responseBody),
			),
		)
	}

	return nil
}

func collectSystemMetrics(
	cpu *cpuSample,
	diskPath string,
) systemMetrics {
	return systemMetrics{
		CPUPercent: readCPUPercent(cpu),

		MemoryPercent: readMemoryPercent(),

		DiskPercent: readDiskPercent(diskPath),

		UptimeSeconds: readUptimeSeconds(),
	}
}

func readCPUPercent(
	previous *cpuSample,
) *float64 {
	value, err := os.ReadFile("/proc/stat")
	if err != nil {
		return nil
	}

	lines := strings.SplitN(string(value), "\n", 2)
	if len(lines) == 0 {
		return nil
	}

	fields := strings.Fields(lines[0])

	if len(fields) < 5 || fields[0] != "cpu" {
		return nil
	}

	values := make([]uint64, 0, len(fields)-1)

	for _, field := range fields[1:] {
		number, err := strconv.ParseUint(
			field,
			10,
			64,
		)
		if err != nil {
			return nil
		}

		values = append(values, number)
	}

	var total uint64

	for _, number := range values {
		total += number
	}

	idle := values[3]

	if len(values) > 4 {
		idle += values[4]
	}

	if !previous.ready {
		previous.total = total
		previous.idle = idle
		previous.ready = true

		return nil
	}

	if total < previous.total || idle < previous.idle {
		previous.total = total
		previous.idle = idle

		return nil
	}

	totalDelta := total - previous.total
	idleDelta := idle - previous.idle

	previous.total = total
	previous.idle = idle

	if totalDelta == 0 {
		return nil
	}

	percentage :=
		(1 - float64(idleDelta)/float64(totalDelta)) * 100

	percentage = math.Max(
		0,
		math.Min(percentage, 100),
	)

	return &percentage
}

func readMemoryPercent() *float64 {
	value, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return nil
	}

	var total uint64
	var available uint64

	for _, line := range strings.Split(
		string(value),
		"\n",
	) {
		fields := strings.Fields(line)

		if len(fields) < 2 {
			continue
		}

		number, err := strconv.ParseUint(
			fields[1],
			10,
			64,
		)
		if err != nil {
			continue
		}

		switch fields[0] {
		case "MemTotal:":
			total = number

		case "MemAvailable:":
			available = number
		}
	}

	if total == 0 || available > total {
		return nil
	}

	percentage :=
		float64(total-available) /
			float64(total) *
			100

	percentage = math.Max(
		0,
		math.Min(percentage, 100),
	)

	return &percentage
}

func readDiskPercent(
	path string,
) *float64 {
	var statistics syscall.Statfs_t

	if err := syscall.Statfs(
		path,
		&statistics,
	); err != nil {
		return nil
	}

	total := statistics.Blocks
	available := statistics.Bavail

	if total == 0 || available > total {
		return nil
	}

	percentage :=
		float64(total-available) /
			float64(total) *
			100

	percentage = math.Max(
		0,
		math.Min(percentage, 100),
	)

	return &percentage
}

func readUptimeSeconds() *int64 {
	value, err := os.ReadFile(
		"/proc/uptime",
	)
	if err != nil {
		return nil
	}

	fields := strings.Fields(
		string(value),
	)

	if len(fields) == 0 {
		return nil
	}

	seconds, err :=
		strconv.ParseFloat(
			fields[0],
			64,
		)
	if err != nil {
		return nil
	}

	result := int64(seconds)

	return &result
}

func envOrDefault(
	name string,
	fallback string,
) string {
	value := strings.TrimSpace(
		os.Getenv(name),
	)

	if value == "" {
		return fallback
	}

	return value
}
