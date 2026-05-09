import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "../api.ts";
import { Button, Input, Label } from "../ui.tsx";

export function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("director@planwell.local");
  const [password, setPassword] = useState("planwell-demo");
  const login = useMutation({
    mutationFn: () => client.login(email, password),
    onSuccess: onSignedIn,
  });

  return (
    <main className="login-shell">
      <section className="login-visual">
        <div>
          <p className="eyebrow">PlanWell</p>
          <h1>FP&A planning workbench</h1>
          <p>
            Import actuals, tune driver assumptions, compare scenarios, and ask grounded questions
            over the planning cube.
          </p>
        </div>
        <div className="mini-model">
          <span>Actuals</span>
          <span>Drivers</span>
          <span>Forecast</span>
          <span>Analyst</span>
        </div>
      </section>
      <form
        className="login-form"
        onSubmit={(event) => {
          event.preventDefault();
          login.mutate();
        }}
      >
        <p className="eyebrow">Local demo</p>
        <h2>Sign in</h2>
        <label>
          <Label>Email</Label>
          <Input
            aria-label="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          <Label>Password</Label>
          <Input
            aria-label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {login.error ? <p className="error">{login.error.message}</p> : null}
        <Button type="submit" disabled={login.isPending}>
          {login.isPending ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </main>
  );
}
