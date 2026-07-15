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
				OR EXISTS (
					SELECT 1
					FROM subscriptions AS s
					WHERE
						s.organization_id =
							pc.organization_id
						AND s.status IN (
							'TRIAL',
							'ACTIVE'
						)
						AND s.current_period_end > NOW()
				)
			) AS subscription_active
		FROM proxy_credentials AS pc
		INNER JOIN users AS u
			ON u.id = pc.user_id
		WHERE pc.username = $1
		LIMIT 1
	`

	var credential Credential
	var expiresAt pgtype.Timestamptz

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

	return credential, nil
}
