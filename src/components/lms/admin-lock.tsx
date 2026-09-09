import { Lock, LockOpen, Delete } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ADMIN_PIN = "1234";

const AdminContext = createContext<{ unlocked: boolean; setUnlocked: (v: boolean) => void }>({
  unlocked: false,
  setUnlocked: () => {},
});

export function AdminProvider({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  return <AdminContext value={{ unlocked, setUnlocked }}>{children}</AdminContext>;
}

export function useAdmin() {
  return useContext(AdminContext);
}

export function AdminPadlock() {
  const { unlocked, setUnlocked } = useAdmin();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  const press = (digit: string) => {
    setError(false);
    const next = (pin + digit).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      if (next === ADMIN_PIN) {
        setUnlocked(true);
        setOpen(false);
        setPin("");
      } else {
        setError(true);
        setTimeout(() => setPin(""), 250);
      }
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (unlocked) {
            setUnlocked(false);
          } else {
            setPin("");
            setError(false);
            setOpen(true);
          }
        }}
        aria-label={unlocked ? "Lock admin mode" : "Unlock admin mode"}
        className={cn(
          "flex h-12 min-w-12 items-center gap-2 rounded-2xl px-4 text-base font-semibold transition-colors",
          unlocked
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground",
        )}
      >
        {unlocked ? <LockOpen className="size-5" /> : <Lock className="size-5" />}
        <span className="hidden sm:inline">{unlocked ? "Admin" : "Locked"}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-center text-xl">Enter admin PIN</DialogTitle>
          </DialogHeader>
          <div className="flex justify-center gap-3 py-2">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={cn(
                  "size-4 rounded-full border-2",
                  error
                    ? "border-destructive bg-destructive"
                    : pin.length > i
                      ? "border-primary bg-primary"
                      : "border-border",
                )}
              />
            ))}
          </div>
          {error ? (
            <p className="text-center text-sm font-medium text-destructive">
              Wrong PIN, try again
            </p>
          ) : null}
          <div className="grid grid-cols-3 gap-3 pt-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <KeypadButton key={d} onClick={() => press(d)}>
                {d}
              </KeypadButton>
            ))}
            <KeypadButton onClick={() => setPin("")}>C</KeypadButton>
            <KeypadButton onClick={() => press("0")}>0</KeypadButton>
            <KeypadButton onClick={() => setPin(pin.slice(0, -1))}>
              <Delete className="size-6" />
            </KeypadButton>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function KeypadButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-16 items-center justify-center rounded-2xl bg-secondary text-2xl font-semibold text-secondary-foreground transition-colors active:bg-primary active:text-primary-foreground"
    >
      {children}
    </button>
  );
}
