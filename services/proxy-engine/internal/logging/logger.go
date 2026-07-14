package logging

import (
	"log/slog"
	"os"
	"strings"
)

func New(environment string, level string) *slog.Logger {
	var logLevel slog.Level

	switch strings.ToLower(level) {
	case "debug":
		logLevel = slog.LevelDebug
	case "warn":
		logLevel = slog.LevelWarn
	case "error":
		logLevel = slog.LevelError
	default:
		logLevel = slog.LevelInfo
	}

	options := &slog.HandlerOptions{
		Level:     logLevel,
		AddSource: environment == "development",
	}

	var handler slog.Handler

	if environment == "development" {
		handler = slog.NewTextHandler(os.Stdout, options)
	} else {
		handler = slog.NewJSONHandler(os.Stdout, options)
	}

	return slog.New(handler).With(
		slog.String("service", "proxy-engine"),
		slog.String("environment", environment),
	)
}
