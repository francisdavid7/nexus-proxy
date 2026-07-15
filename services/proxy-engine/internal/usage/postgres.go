package usage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/auth"
)

type SessionStatus string

const (
	SessionClosed SessionStatus = "CLOSED"
	SessionFailed SessionStatus = "FAILED"
)

type PostgresRecorder struct {
	logger *slog.Logger
	pool   *pgxpool.Pool
	nodeID string
}

func NewPostgresRecorder(
	ctx context.Context,
	logger *slog.Logger,
	pool *pgxpool.Pool,
	nodeReference string,
) (*PostgresRecorder, error) {
	const query = `
		SELECT id::text
		FROM proxy_nodes
		WHERE
			id::text = $1
			OR hostname = $1
			OR name = $1
		LIMIT 1
	`

	var nodeID string

	if err := pool.QueryRow(
		ctx,
		query,
		nodeReference,
	).Scan(&nodeID); err != nil {
		return nil, fmt.Errorf(
			"resolve proxy node %q: %w",
			nodeReference,
			err,
		)
	}

	return &PostgresRecorder{
		logger: logger,
		pool:   pool,
		nodeID: nodeID,
	}, nil
}

func (r *PostgresRecorder) StartSession(
	ctx context.Context,
	principal auth.Principal,
	protocol auth.Protocol,
) (string, error) {
	sessionID, err := newUUID()
	if err != nil {
		return "", fmt.Errorf(
			"generate session ID: %w",
			err,
		)
	}

	transaction, err := r.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf(
			"begin session transaction: %w",
			err,
		)
	}

	defer func() {
		_ = transaction.Rollback(ctx)
	}()

	const createSessionQuery = `
		INSERT INTO connection_sessions (
			id,
			organization_id,
			user_id,
			credential_id,
			node_id,
			protocol,
			status,
			bytes_uploaded,
			bytes_downloaded,
			started_at
		)
		VALUES (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			$5::uuid,
			$6::"ProxyProtocol",
			'ACTIVE'::"SessionStatus",
			0,
			0,
			NOW()
		)
	`

	_, err = transaction.Exec(
		ctx,
		createSessionQuery,
		sessionID,
		principal.OrganizationID,
		principal.UserID,
		principal.CredentialID,
		r.nodeID,
		string(protocol),
	)

	if err != nil {
		return "", fmt.Errorf(
			"create connection session: %w",
			err,
		)
	}

	const updateNodeQuery = `
		UPDATE proxy_nodes
		SET
			active_connections =
				active_connections + 1,
			last_heartbeat_at = NOW(),
			status = 'ONLINE'::"NodeStatus"
		WHERE id = $1::uuid
	`

	if _, err := transaction.Exec(
		ctx,
		updateNodeQuery,
		r.nodeID,
	); err != nil {
		return "", fmt.Errorf(
			"increment active connections: %w",
			err,
		)
	}

	if err := transaction.Commit(ctx); err != nil {
		return "", fmt.Errorf(
			"commit session transaction: %w",
			err,
		)
	}

	r.logger.Debug(
		"connection session started",
		slog.String("session_id", sessionID),
		slog.String(
			"credential_id",
			principal.CredentialID,
		),
		slog.String(
			"protocol",
			string(protocol),
		),
	)

	return sessionID, nil
}

func (r *PostgresRecorder) FinishSession(
	ctx context.Context,
	sessionID string,
	bytesUploaded int64,
	bytesDownloaded int64,
	status SessionStatus,
) error {
	if bytesUploaded < 0 {
		bytesUploaded = 0
	}

	if bytesDownloaded < 0 {
		bytesDownloaded = 0
	}

	transaction, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf(
			"begin session completion transaction: %w",
			err,
		)
	}

	defer func() {
		_ = transaction.Rollback(ctx)
	}()

	const finishSessionQuery = `
		UPDATE connection_sessions
		SET
			status = $2::"SessionStatus",
			bytes_uploaded = $3,
			bytes_downloaded = $4,
			ended_at = NOW()
		WHERE id = $1::uuid
	`

	result, err := transaction.Exec(
		ctx,
		finishSessionQuery,
		sessionID,
		string(status),
		bytesUploaded,
		bytesDownloaded,
	)

	if err != nil {
		return fmt.Errorf(
			"finish connection session: %w",
			err,
		)
	}

	if result.RowsAffected() != 1 {
		return fmt.Errorf(
			"connection session %s was not found",
			sessionID,
		)
	}

	const updateNodeQuery = `
		UPDATE proxy_nodes
		SET
			active_connections =
				GREATEST(active_connections - 1, 0),
			last_heartbeat_at = NOW()
		WHERE id = $1::uuid
	`

	if _, err := transaction.Exec(
		ctx,
		updateNodeQuery,
		r.nodeID,
	); err != nil {
		return fmt.Errorf(
			"decrement active connections: %w",
			err,
		)
	}

	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf(
			"commit session completion: %w",
			err,
		)
	}

	r.logger.Debug(
		"connection session finished",
		slog.String("session_id", sessionID),
		slog.Int64(
			"bytes_uploaded",
			bytesUploaded,
		),
		slog.Int64(
			"bytes_downloaded",
			bytesDownloaded,
		),
		slog.String(
			"status",
			string(status),
		),
	)

	return nil
}

func newUUID() (string, error) {
	var value [16]byte

	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}

	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80

	encoded := make([]byte, 36)

	hex.Encode(encoded[0:8], value[0:4])
	encoded[8] = '-'

	hex.Encode(encoded[9:13], value[4:6])
	encoded[13] = '-'

	hex.Encode(encoded[14:18], value[6:8])
	encoded[18] = '-'

	hex.Encode(encoded[19:23], value[8:10])
	encoded[23] = '-'

	hex.Encode(encoded[24:36], value[10:16])

	return string(encoded), nil
}
