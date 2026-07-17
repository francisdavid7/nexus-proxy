"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

export class ApiRequestError
  extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: unknown,
  ) {
    super(message);
  }
}

function extractMessage(
  payload: unknown,
  fallback: string,
): string {
  if (
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof payload.message === "string"
  ) {
    return payload.message;
  }

  return fallback;
}

export async function requestJSON<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(
    input,
    {
      credentials: "include",
      cache: "no-store",
      ...init,

      headers: {
        Accept: "application/json",
        ...init?.headers,
      },
    },
  );

  const contentType =
    response.headers.get(
      "content-type",
    ) ?? "";

  const payload: unknown =
    contentType.includes(
      "application/json",
    )
      ? await response.json()
      : await response.text();

  if (!response.ok) {
    throw new ApiRequestError(
      extractMessage(
        payload,
        `Request failed with HTTP ${response.status}.`,
      ),
      response.status,
      payload,
    );
  }

  return payload as T;
}

type ResourceState<T> = {
  requestKey: string | null;
  data: T | null;
  error: string | null;
};

export function useApiResource<T>(
  url: string | null,
) {
  const [
    refreshVersion,
    setRefreshVersion,
  ] = useState(0);

  const [
    state,
    setState,
  ] = useState<ResourceState<T>>({
    requestKey: null,
    data: null,
    error: null,
  });

  const requestKey = url
    ? JSON.stringify([
        url,
        refreshVersion,
      ])
    : null;

  const refresh = useCallback(() => {
    setRefreshVersion(
      (current) => current + 1,
    );
  }, []);

  useEffect(() => {
    if (!url || !requestKey) {
      return;
    }

    const controller =
      new AbortController();

    let active = true;

    requestJSON<T>(
      url,
      {
        signal: controller.signal,
      },
    )
      .then((data) => {
        if (!active) {
          return;
        }

        setState({
          requestKey,
          data,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          return;
        }

        setState({
          requestKey,
          data: null,

          error:
            error instanceof Error
              ? error.message
              : "The request failed.",
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    requestKey,
    url,
  ]);

  const currentRequestFinished =
    state.requestKey === requestKey;

  return {
    data:
      requestKey &&
      currentRequestFinished
        ? state.data
        : null,

    error:
      requestKey &&
      currentRequestFinished
        ? state.error
        : null,

    loading:
      Boolean(requestKey) &&
      !currentRequestFinished,

    refresh,
  };
}
