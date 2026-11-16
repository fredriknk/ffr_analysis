import { useEffect } from "react";
import { error } from "../feedback";
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Status({
  loading,
  error: e,
}: {
  loading: boolean;
  error: Error | null;
}) {
  useEffect(() => {
    if (e) error(e);
  }, [e]);
  return loading ? (
    <Empty>Loading measurements…</Empty>
  ) : e ? (
    <Empty>
      Could not load this view.{" "}
      <button onClick={() => location.reload()}>Retry</button>
    </Empty>
  ) : null;
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Panel({
  title,
  children,
  extra,
}: {
  title: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h3>{title}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}
