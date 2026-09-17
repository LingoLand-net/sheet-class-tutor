import { useMutation } from "@tanstack/react-query";
import { Delete, Loader2, Lock, LockOpen } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AUTH_EXPIRED_EVENT,
  clearSession,
  readSession,
  writeSession,
} from "@/lib/auth-client";
import { unlockAdmin } from "@/lib/lms.functions";
import { cn } from "@/lib/utils";

const PIN_LENGTH = 8;

type AdminContextValue = {
  unlocked: boolean;
  setUnlocked: (v: boolean) => void;
};

const AdminContext = createContext<AdminContextValue>({
  unlocked: false,
  setUnlocked: () => {},
});

export function AdminProvider({ children }: { children: ReactNode }) {
  const [unlocked, setUnlockedState] = useState(() => readSession() !== null);

  const setUnlocked = useCallback((v: boolean) => {
    if (!v) clearSession();
    setUnlockedState(v);
  }, []);

  useEffect(() => {
    const onExpired = () => setUnlockedState(false);
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const value = useMemo<AdminContextValue>(
    () => ({ unlocked, setUnlocked }),
    [unlocked, setUnlocked],
  );
  return <AdminContext value={value}>{children}</AdminContext>;
}

export function useAdmin() {
  return useContext(AdminContext);
}

type LockStatus =
  | { kind: "idle" }
  | { kind: "wrong" }
  | { kind: "rate-limited"; retryAfterSec: number }
  | { kind: "misconfigured" }
  | { kind: "error" };

export function AdminPadlock() {
  const { unlocked, setUnlocked } = useAdmin();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState<LockStatus>({ kind: "idle" });

  const mutation = useMutation({
    mutationFn: (value: string) => unlockAdmin({ data: { pin: value } }),
    onSuccess: (session) => {
      writeSession(session);
      setUnlocked(true);
      setOpen(false);
      setPin("");
      setStatus({ kind: "idle" });
    },
    onError: (err) => {
      setPin("");
      const message = err instanceof Error ? err.message : "";
      if (message.startsWith("RATE_LIMITED:")) {
        const sec = Number(message.split(":")[1]) || 900;
        setStatus({ kind: "rate-limited", retryAfterSec: sec });
      } else if (message.includes("INVALID_PIN")) {
        setStatus({ kind: "wrong" });
      } else if (message.includes("SERVER_MISCONFIGURED")) {
        setStatus({ kind: "misconfigured" });
      } else {
        setStatus({ kind: "error" });
      }
    },
  });

  const press = (digit: string) => {
    if (mutation.isPending) return;
    if (status.kind === "rate-limited") return;
    setStatus({ kind: "idle" });
    const next = (pin + digit).slice(0, PIN_LENGTH);
    setPin(next);
    if (next.length === PIN_LENGTH) {
      mutation.mutate(next);
    }
  };

  const openDialog = () => {
    setPin("");
    setStatus({ kind: "idle" });
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => (unlocked ? setUnlocked(false) : openDialog())}
        aria-label={unlocked ? "Lock admin mode" : "Unlock admin mode"}
        className={cn(
          "flex h-12 min-w-12 items-center gap-2 rounded-2xl px-4 text-base font-semibold shadow-md transition-colors",
          unlocked
            ? "bg-primary text-primary-foreground"
            : "bg-card text-foreground ring-1 ring-border",
        )}
      >
        {unlocked ? <LockOpen className="size-5" /> : <Lock className="size-5" />}
        <span className="hidden sm:inline">{unlocked ? "Admin" : "Locked"}</span>
      </button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (mutation.isPending) return;
          setOpen(v);
          if (!v) {
            setPin("");
            setStatus({ kind: "idle" });
          }
        }}
      >
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-center text-xl">Enter PIN</DialogTitle>
          </DialogHeader>

          <div className="flex justify-center gap-1.5 py-2">
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "size-3 rounded-full border-2 transition-colors",
                  status.kind === "wrong" || status.kind === "rate-limited"
                    ? "border-destructive bg-destructive"
                    : pin.length > i
                      ? "border-primary bg-primary"
                      : "border-border",
                )}
              />
            ))}
          </div>

          {status.kind === "wrong" ? (
            <p className="text-center text-sm font-medium text-destructive">
              Wrong PIN. Try again.
            </p>
          ) : null}
          {status.kind === "rate-limited" ? (
            <p className="text-center text-sm font-medium text-destructive">
              Too many attempts. Try again in {Math.ceil(status.retryAfterSec / 60)} min.
            </p>
          ) : null}
          {status.kind === "misconfigured" ? (
            <p className="text-center text-sm font-medium text-destructive">
              Server auth is not configured. Contact your administrator.
            </p>
          ) : null}
          {status.kind === "error" ? (
            <p className="text-center text-sm font-medium text-destructive">
              Could not sign in. Try again.
            </p>
          ) : null}

          <div className="grid grid-cols-3 gap-3 pt-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <KeypadButton
                key={d}
                onClick={() => press(d)}
                disabled={mutation.isPending || status.kind === "rate-limited"}
              >
                {d}
              </KeypadButton>
            ))}
            <KeypadButton
              onClick={() => setPin("")}
              disabled={mutation.isPending || status.kind === "rate-limited"}
            >
              C
            </KeypadButton>
            <KeypadButton
              onClick={() => press("0")}
              disabled={mutation.isPending || status.kind === "rate-limited"}
            >
              0
            </KeypadButton>
            <KeypadButton
              onClick={() => setPin(pin.slice(0, -1))}
              disabled={mutation.isPending || status.kind === "rate-limited"}
            >
              <Delete className="size-6" />
            </KeypadButton>
          </div>

          {mutation.isPending ? (
            <p className="flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Checking…
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function KeypadButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-16 items-center justify-center rounded-2xl bg-secondary text-2xl font-semibold text-secondary-foreground transition-colors active:bg-primary active:text-primary-foreground disabled:opacity-50"
    >
      {children}
    </button>
  );
}