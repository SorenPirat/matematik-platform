"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/utils/supabaseClient";

const LS_GLOBAL_SESSION_CODE = "session_code_v1";
const LS_GLOBAL_ALIAS = "session_alias_v1";
const LS_GLOBAL_TOKEN_PREFIX = "participant_token_v1:";

type LiveSessionConfig = {
  storageKey: string;
  trackLabel: string;
  onInvalidSession?: () => void;
};

export function useLiveSession(config: LiveSessionConfig) {
  const {
    storageKey,
    trackLabel,
    onInvalidSession,
  } = config;

  const LS_SESSION_CODE = `${storageKey}_session_code_v1`;
  const LS_ALIAS = `${storageKey}_alias_v1`;
  const LS_TOKEN_PREFIX = `${storageKey}_participant_token_v1:`;

  const [sessionCode, setSessionCode] = useState("");
  const [alias, setAlias] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const [isJoined, setIsJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [hasGlobalIdentity, setHasGlobalIdentity] = useState(false);
  const [identityChecked, setIdentityChecked] = useState(false);
  const autoJoinRef = useRef<string | null>(null);

  const roomId = useMemo(() => {
    if (!isJoined || !sessionCode || !alias) return "";
    return `${sessionCode}:${alias}`;
  }, [isJoined, sessionCode, alias]);

  useEffect(() => {
    const savedSession = localStorage.getItem(LS_GLOBAL_SESSION_CODE);
    const savedAlias = localStorage.getItem(LS_GLOBAL_ALIAS);
    const localSession = localStorage.getItem(LS_SESSION_CODE);
    const localAlias = localStorage.getItem(LS_ALIAS);
    const finalSession = savedSession ?? localSession;
    const finalAlias = savedAlias ?? localAlias;
    if (finalSession && finalAlias) {
      setSessionCode(finalSession);
      setAlias(finalAlias);
      setHasGlobalIdentity(Boolean(savedSession && savedAlias));
      if (savedSession && savedAlias) {
        localStorage.setItem(LS_SESSION_CODE, finalSession);
        localStorage.setItem(LS_ALIAS, finalAlias);
      }
    }
    setIdentityChecked(true);
  }, [LS_ALIAS, LS_SESSION_CODE]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("session");
    if (code) {
      setSessionCode(code.toUpperCase());
    }
  }, []);

  useEffect(() => {
    if (!sessionCode || !isJoined) return;
    const loadSession = async () => {
      const { data: session } = await supabase
        .from("sessions")
        .select("id,expires_at")
        .eq("code", sessionCode)
        .maybeSingle();
      if (!session) {
        resetSession();
        return;
      }
      const expiresAt = new Date(session.expires_at).getTime();
      if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
        resetSession();
        return;
      }
      setSessionId(session.id);
      setSessionExpiresAt(expiresAt);
    };
    loadSession();
  }, [sessionCode, isJoined]);

  useEffect(() => {
    if (!sessionExpiresAt) return;
    const delay = sessionExpiresAt - Date.now();
    if (delay <= 0) {
      resetSession();
      return;
    }
    const timer = window.setTimeout(() => {
      resetSession();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [sessionExpiresAt]);

  useEffect(() => {
    if (!sessionId || !alias || !isJoined) return;
    const update = () => {
      supabase
        .from("participants")
        .update({ last_seen: new Date().toISOString() })
        .eq("session_id", sessionId)
        .eq("alias", alias)
        .select("alias")
        .then(({ data, error }) => {
          if (error) return;
          if (!data || data.length === 0) {
            leaveSession("Du er blevet fjernet fra sessionen.");
          }
        });
    };
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, [sessionId, alias, isJoined]);

  useEffect(() => {
    if (!sessionId || !alias || !isJoined) return;
    const channel = supabase
      .channel(`participant-kick:${sessionId}:${alias}`)
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "participants",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const oldRow = payload.old as { alias?: string } | null;
          if (oldRow?.alias === alias) {
            leaveSession("Du er blevet fjernet fra sessionen.");
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, alias, isJoined]);

  useEffect(() => {
    if (!roomId) return;
    const sendPresence = (state: "open" | "hidden" | "closed") => {
      fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room: roomId,
          event: { type: "presence", state, track: trackLabel, ts: Date.now() },
        }),
        keepalive: true,
      }).catch(() => {});
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        sendPresence("hidden");
      } else {
        sendPresence("open");
      }
    };

    sendPresence("open");
    const interval = setInterval(() => sendPresence("open"), 10000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", () => sendPresence("closed"));
    window.addEventListener("beforeunload", () => sendPresence("closed"));

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [roomId, trackLabel]);

  useEffect(() => {
    if (!roomId) return;
    const source = new EventSource(
      `/api/live?room=${encodeURIComponent(roomId)}`
    );
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string };
        if (payload.type === "kick") {
          leaveSession("Du er blevet fjernet fra sessionen.");
        }
      } catch {
        return;
      }
    };
    return () => {
      source.close();
    };
  }, [roomId]);

  useEffect(() => {
    if (isJoined || joining) return;
    if (!sessionCode || !alias) return;
    const key = `${sessionCode}:${alias}`;
    if (autoJoinRef.current === key) return;
    autoJoinRef.current = key;
    joinSession(sessionCode, alias);
  }, [sessionCode, alias, isJoined, joining]);

  async function joinSession(nextSession: string, nextAlias: string) {
    const trimmedSession = nextSession.trim().toUpperCase();
    const trimmedAlias = nextAlias.trim().replace(/:/g, "");
    if (!trimmedSession || !trimmedAlias) {
      setJoinError("Udfyld sessionkode og alias.");
      return;
    }
    setJoining(true);
    setJoinError("");
    const { data: session, error } = await supabase
      .from("sessions")
      .select("id,code,expires_at")
      .eq("code", trimmedSession)
      .maybeSingle();
    if (error || !session) {
      leaveSession("Sessionkode findes ikke.");
      onInvalidSession?.();
      setJoining(false);
      return;
    }
    const expiresAt = new Date(session.expires_at).getTime();
    if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
      setJoinError("Sessionen er udløbet.");
      setJoining(false);
      return;
    }

    const tokenKey = `${LS_TOKEN_PREFIX}${trimmedSession}:${trimmedAlias}`;
    const globalTokenKey = `${LS_GLOBAL_TOKEN_PREFIX}${trimmedSession}:${trimmedAlias}`;
    const existingToken =
      localStorage.getItem(globalTokenKey) ?? localStorage.getItem(tokenKey);

    const { data: existingAlias } = await supabase
      .from("participants")
      .select("alias,last_seen,client_token")
      .eq("session_id", session.id)
      .eq("alias", trimmedAlias)
      .maybeSingle();

    if (existingAlias?.last_seen) {
      const lastSeen = new Date(existingAlias.last_seen).getTime();
      const isRecent =
        Number.isFinite(lastSeen) && Date.now() - lastSeen < 2 * 60 * 1000;
      const tokenMatches =
        existingToken && existingAlias.client_token === existingToken;
      if (isRecent && !tokenMatches) {
        setJoinError("Alias er allerede i brug. Vælg et andet.");
        setJoining(false);
        return;
      }
    }

    const clientToken =
      existingToken ?? crypto.randomUUID().replace(/-/g, "");
    const { error: upsertError } = await supabase
      .from("participants")
      .upsert(
        {
          session_id: session.id,
          alias: trimmedAlias,
          last_seen: new Date().toISOString(),
          client_token: clientToken,
        },
        { onConflict: "session_id,alias" }
      );

    if (upsertError) {
      setJoinError("Kunne ikke forbinde til sessionen.");
      setJoining(false);
      return;
    }

    localStorage.setItem(tokenKey, clientToken);
    localStorage.setItem(globalTokenKey, clientToken);
    localStorage.setItem(LS_SESSION_CODE, trimmedSession);
    localStorage.setItem(LS_ALIAS, trimmedAlias);
    localStorage.setItem(LS_GLOBAL_SESSION_CODE, trimmedSession);
    localStorage.setItem(LS_GLOBAL_ALIAS, trimmedAlias);
    setSessionCode(trimmedSession);
    setAlias(trimmedAlias);
    setSessionId(session.id);
    setIsJoined(true);
    setJoining(false);
  }

  function leaveSession(message?: string) {
    if (sessionCode && alias) {
      const tokenKey = `${LS_TOKEN_PREFIX}${sessionCode}:${alias}`;
      const globalTokenKey = `${LS_GLOBAL_TOKEN_PREFIX}${sessionCode}:${alias}`;
      localStorage.removeItem(tokenKey);
      localStorage.removeItem(globalTokenKey);
    }
    localStorage.removeItem(LS_SESSION_CODE);
    localStorage.removeItem(LS_ALIAS);
    localStorage.removeItem(LS_GLOBAL_SESSION_CODE);
    localStorage.removeItem(LS_GLOBAL_ALIAS);
    setSessionCode("");
    setAlias("");
    setSessionId("");
    setSessionExpiresAt(null);
    setIsJoined(false);
    setHasGlobalIdentity(false);
    if (message) setJoinError(message);
  }

  function resetSession() {
    leaveSession();
  }

  return {
    sessionCode,
    setSessionCode,
    alias,
    setAlias,
    sessionId,
    sessionExpiresAt,
    isJoined,
    joining,
    joinError,
    hasGlobalIdentity,
    identityChecked,
    roomId,
    joinSession,
    leaveSession,
    resetSession,
  };
}
