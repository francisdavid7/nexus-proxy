package usage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/auth"
)

var (
	ErrConcurrentLimit = errors.New(
		"maximum concurrent connections reached",
	)

	ErrBandwidthLimit = errors.New(
		"subscription bandwidth limit reached",
	)

	ErrNodeCapacity = errors.New(
		"proxy node is at maximum capacity",
	)
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

	recorder := &PostgresRecorder{
		logger: logger,
		pool:   pool,
		nodeID: nodeID,
	}

	if err := recorder.recoverStaleSessions(ctx); err != nil {
		return nil, err
	}

	return recorder, nil
}

func (r *PostgresRecorder) StartSession(
	ctx context.Context,
	principal auth.Principal,
	protocol auth.Protocol,
) (string, error) {
	transaction, err := r.pool.BeginTx(
		ctx,
		pgx.TxOptions{},
	)
	if err != nil {
		return "", fmt.Errorf(
			"begin session transaction: %w",
			err,
		)
	}

	defer func() {
		_ = transaction.Rollback(ctx)
	}()

	const lockCredentialQuery = `
		SELECT id
		FROM proxy_credentials
		WHERE id = $1::uuid
		FOR UPDATE
	`

	var credentialID string

	if err := transaction.QueryRow(
		ctx,
		lockCredentialQuery,
		principal.CredentialID,
	).Scan(&credentialID); err != nil {
		return "", fmt.Errorf(
			"lock proxy credential: %w",
			err,
		)
	}

	const activeSessionsQuery = `
		SELECT COUNT(*)
		FROM connection_sessions
		WHERE
			credential_id = $1::uuid
			AND status = 'ACTIVE'::"SessionStatus"
	`

	var activeSessions int

	if err := transaction.QueryRow(
		ctx,
		activeSessionsQuery,
		principal.CredentialID,
	).Scan(&activeSessions); err != nil {
		return "", fmt.Errorf(
			"count active sessions: %w",
			err,
		)
	}

	if principal.MaxConcurrentConnections > 0 &&
		activeSessions >=
			principal.MaxConcurrentConnections {
		return "", ErrConcurrentLimit
	}

	if principal.BandwidthLimitBytes != nil {
		const bandwidthQuery = `
			SELECT COALESCE(
				SUM(
					bytes_uploaded
					+ bytes_downloaded
				),
				0
			)::bigint

			FROM connection_sessions

			WHERE
				organization_id = $1::uuid
				AND started_at >= $2
				AND started_at < $3
		`

		var usedBytes int64

		if err := transaction.QueryRow(
			ctx,
			bandwidthQuery,
			principal.OrganizationID,
			principal.CurrentPeriodStart,
			principal.CurrentPeriodEnd,
		).Scan(&usedBytes); err != nil {
			return "", fmt.Errorf(
				"calculate bandwidth usage: %w",
				err,
			)
		}

		if usedBytes >=
			*principal.BandwidthLimitBytes {
			return "", ErrBandwidthLimit
		}
	}

	const lockNodeQuery = `
		SELECT
			max_connections,
			active_connections

		FROM proxy_nodes

		WHERE id = $1::uuid

		FOR UPDATE
	`

	var maxNodeConnections int
	var activeNodeConnections int

	if err := transaction.QueryRow(
		ctx,
		lockNodeQuery,
		r.nodeID,
	).Scan(
		&maxNodeConnections,
		&activeNodeConnections,
	); err != nil {
		return "", fmt.Errorf(
			"lock proxy node: %w",
			err,
		)
	}

	if maxNodeConnections > 0 &&
		activeNodeConnections >=
			maxNodeConnections {
		return "", ErrNodeCapacity
	}

	sessionID, err := newUUID()
	if err != nil {
		return "", fmt.Errorf(
			"generate session ID: %w",
			err,
		)
	}

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

	if _, err := transaction.Exec(
		ctx,
		createSessionQuery,
		sessionID,
		principal.OrganizationID,
		principal.UserID,
		principal.CredentialID,
		r.nodeID,
		string(protocol),
	); err != nil {
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
			"begin session completion: %w",
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

		WHERE
			id = $1::uuid
			AND status = 'ACTIVE'::"SessionStatus"

		RETURNING
			organization_id::text,
			user_id::text,
			credential_id::text,
			node_id::text,
			started_at
	`

	var organizationID string
	var userID string
	var credentialID string
	var nodeID string
	var startedAt any

	err = transaction.QueryRow(
		ctx,
		finishSessionQuery,
		sessionID,
		string(status),
		bytesUploaded,
		bytesDownloaded,
	).Scan(
		&organizationID,
		&userID,
		&credentialID,
		&nodeID,
		&startedAt,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}

	if err != nil {
		return fmt.Errorf(
			"finish connection session: %w",
			err,
		)
	}

	const updateNodeQuery = `
		UPDATE proxy_nodes
		SET
			active_connections =
				GREATEST(
					active_connections - 1,
					0
				),
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

	usageID, err := newUUID()
	if err != nil {
		return err
	}

	const usageQuery = `
		INSERT INTO usage_records (
			id,
			organization_id,
			user_id,
			credential_id,
			node_id,
			period_start,
			period_end,
			bytes_uploaded,
			bytes_downloaded,
			connection_count,
			created_at,
			updated_at
		)
		VALUES (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			$5::uuid,
			date_trunc(
				'day',
				$6::timestamptz
			),
			date_trunc(
				'day',
				$6::timestamptz
			) + INTERVAL '1 day',
			$7,
			$8,
			1,
			NOW(),
			NOW()
		)

		ON CONFLICT (
			credential_id,
			node_id,
			period_start,
			period_end
		)

		DO UPDATE SET
			bytes_uploaded =
				usage_records.bytes_uploaded
				+ EXCLUDED.bytes_uploaded,

			bytes_downloaded =
				usage_records.bytes_downloaded
				+ EXCLUDED.bytes_downloaded,

			connection_count =
				usage_records.connection_count
				+ 1,

			updated_at = NOW()
	`

	if _, err := transaction.Exec(
		ctx,
		usageQuery,
		usageID,
		organizationID,
		userID,
		credentialID,
		nodeID,
		startedAt,
		bytesUploaded,
		bytesDownloaded,
	); err != nil {
		return fmt.Errorf(
			"aggregate usage record: %w",
			err,
		)
	}

	return transaction.Commit(ctx)
}

func (r *PostgresRecorder) recoverStaleSessions(
	ctx context.Context,
) error {
	transaction, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}

	defer func() {
		_ = transaction.Rollback(ctx)
	}()

	const recoverQuery = `
		UPDATE connection_sessions
		SET
			status = 'FAILED'::"SessionStatus",
			ended_at = NOW()
		WHERE
			node_id = $1::uuid
			AND status = 'ACTIVE'::"SessionStatus"
	`

	if _, err := transaction.Exec(
		ctx,
		recoverQuery,
		r.nodeID,
	); err != nil {
		return fmt.Errorf(
			"recover stale sessions: %w",
			err,
		)
	}

	const resetNodeQuery = `
		UPDATE proxy_nodes
		SET
			active_connections = 0,
			last_heartbeat_at = NOW(),
			status = 'ONLINE'::"NodeStatus"
		WHERE id = $1::uuid
	`

	if _, err := transaction.Exec(
		ctx,
		resetNodeQuery,
		r.nodeID,
	); err != nil {
		return fmt.Errorf(
			"reset node connection count: %w",
			err,
		)
	}

	return transaction.Commit(ctx)
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
