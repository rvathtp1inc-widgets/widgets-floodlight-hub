type WebhookSettingsCardProps = {
  defaultWebhookHeaderName: string;
  headerNameError?: string;
  onHeaderNameChange: (value: string) => void;
};

export function WebhookSettingsCard({
  defaultWebhookHeaderName,
  headerNameError,
  onHeaderNameChange,
}: WebhookSettingsCardProps) {
  return (
    <section className="rounded-lg border border-slate-700/80 bg-slate-900/70 p-4">
      <h2 className="text-lg font-semibold text-white">Webhook Settings</h2>
      <p className="mt-1 text-sm text-slate-400">
        External systems must send the shared secret using this header name. Default is X-Widgets-Secret.
      </p>

      <label className="mt-4 block text-sm text-slate-200">
        Webhook Header Name
        <input
          className="mt-1 w-full rounded bg-slate-800 px-2 py-1"
          value={defaultWebhookHeaderName}
          onChange={(event) => onHeaderNameChange(event.target.value)}
          placeholder="X-Widgets-Secret"
        />
        {headerNameError ? <p className="mt-1 text-xs text-rose-300">{headerNameError}</p> : null}
      </label>
    </section>
  );
}
