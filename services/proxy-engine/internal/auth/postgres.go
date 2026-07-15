package auth

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresCredentialRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresCredentialRepository(
	pool *pgxpool.Pool,
) *PostgresCredentialRepository {
	return &PostgresCredentialRepository{
		pool: pool,
	}
}

func (r *PostgresCredentialRepository) FindByUsername(
	ctx context.Context,
	username string,
) (Credential, error) {
	const query = `
		SELECT
			pc.id::text,
			pc.organization_id::text,
			pc.user_id::text,
			pc.username,
			pc.secret_digest,
			pc.status::text,
			u.status::text,
			pc.allowed_protocols::text[],
			pc.expires_at,

			(
				u.role = 'SUPER_ADMIN'
				OR policy.subscription_id IS NOT NULL
			) AS subscription_active,

			policy.bandwidth_limit_bytes,

			COALESCE(
				policy.max_concurrent_connections,
				5
			),

			COALESCE(
				policy.connections_per_minute,
				60
			),

			COALESCE(
				policy.current_period_start,
				date_trunc('month', NOW())
			),

			COALESCE(
				policy.current_period_end,
				date_trunc('month', NOW())
					+ INTERVAL '1 month'
			)

		FROM proxy_credentials AS pc

		INNER JOIN users AS u
			ON u.id = pc.user_id

		LEFT JOIN LATERAL (
			SELECT
				s.id AS subscription_id,
				s.current_period_start,
				s.current_period_end,
				p.bandwidth_limit_bytes,
				p.max_concurrent_connections,
				p.connections_per_minute

			FROM subscriptions AS s

			INNER JOIN plans AS p
				ON p.id = s.plan_id

			WHERE
				s.organization_id =
					pc.organization_id

				AND s.status IN (
					'TRIAL',
					'ACTIVE'
				)

				AND s.current_period_start <= NOW()
				AND s.current_period_end > NOW()
				AND p.active = TRUE

			ORDER BY s.current_period_end DESC

			LIMIT 1
		) AS policy ON TRUE

		WHERE pc.username = $1

		LIMIT 1
	`

	var credential Credential

	var expiresAt pgtype.Timestamptz
	var bandwidthLimit pgtype.Int8
	var periodStart pgtype.Timestamptz
	var periodEnd pgtype.Timestamptz

	err := r.pool.QueryRow(
		ctx,
		query,
		username,
	).Scan(
		&credential.ID,
		&credential.OrganizationID,
		&credential.UserID,
		&credential.Username,
		&credential.SecretDigest,
		&credential.Status,
		&credential.UserStatus,
		&credential.AllowedProtocols,
		&expiresAt,
		&credential.SubscriptionActive,
		&bandwidthLimit,
		&credential.MaxConcurrentConnections,
		&credential.ConnectionsPerMinute,
		&periodStart,
		&periodEnd,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return Credential{}, ErrCredentialNotFound
	}

	if err != nil {
		return Credential{}, err
	}

	if expiresAt.Valid {
		expiration := expiresAt.Time
		credential.ExpiresAt = &expiration
	}

	if bandwidthLimit.Valid {
		value := bandwidthLimit.Int64
		credential.BandwidthLimitBytes = &value
	}

	credential.CurrentPeriodStart = periodStart.Time
	credential.CurrentPeriodEnd = periodEnd.Time

	return credential, nil
}
