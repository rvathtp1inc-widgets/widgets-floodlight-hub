import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AxiosError } from 'axios';
import {
  useCreateEventRoute,
  useDeleteEventRoute,
  useEventRoutes,
  useProtectSources,
  useRouteTargets,
  useUpdateEventRoute,
} from '../hooks/useEventRoutes';
import type { BindingStatus, EventClass, EventRoute, EventRouteInput, TargetType } from '../api/eventRoutes';

type FormValues = {
  sourceId: string;
  eventClass: EventClass;
  upstreamEventType: string;
  objectTypes: string[];
  targetType: TargetType | '';
  targetId: string;
  bindingStatus: BindingStatus;
  enabled: boolean;
  notes: string;
};

type ActionMessage = { type: 'success' | 'error'; text: string } | null;

const eventClassOptions: Array<{ value: EventClass; label: string }> = [
  { value: 'motion', label: 'Motion' },
  { value: 'zone', label: 'Smart Detect Zone' },
  { value: 'line', label: 'Smart Detect Line' },
  { value: 'audio', label: 'Smart Audio Detect' },
  { value: 'loiter', label: 'Smart Detect Loiter' },
];
const bindingStatusOptions: BindingStatus[] = ['resolved', 'unresolved'];
const targetTypeOptions: TargetType[] = ['floodlight', 'group'];
const upstreamTypeByClass: Record<EventClass, { value: string; label: string }> = {
  motion: { value: 'motion', label: 'cameraMotionEvent / motion' },
  zone: { value: 'smartDetectZone', label: 'cameraSmartDetectZoneEvent / smartDetectZone' },
  line: { value: 'smartDetectLine', label: 'cameraSmartDetectLineEvent / smartDetectLine' },
  audio: { value: 'smartAudioDetect', label: 'cameraSmartDetectAudioEvent / smartAudioDetect' },
  loiter: { value: 'smartDetectLoiter', label: 'cameraSmartDetectLoiterEvent / smartDetectLoiter' },
};
const objectTypesByClass: Record<EventClass, string[]> = {
  motion: [],
  zone: ['person', 'vehicle', 'package', 'licensePlate', 'face', 'animal'],
  line: ['person', 'vehicle', 'package', 'licensePlate', 'face', 'animal'],
  loiter: ['person', 'vehicle', 'package', 'licensePlate', 'face', 'animal'],
  audio: ['alarmSmoke', 'alarmCmonx', 'alarmSiren', 'alarmBabyCry', 'alarmSpeak', 'alarmBark', 'alarmBurglar', 'alarmCarHorn', 'alarmGlassBreak'],
};

const defaultValues: FormValues = {
  sourceId: '',
  eventClass: 'zone',
  upstreamEventType: upstreamTypeByClass.zone.value,
  objectTypes: [],
  targetType: 'floodlight',
  targetId: '',
  bindingStatus: 'resolved',
  enabled: true,
  notes: '',
};

function getErrorMessage(error: unknown): string {
  const axiosError = error as AxiosError<{ details?: string; message?: string; error?: string }>;
  return (
    axiosError.response?.data?.details ??
    axiosError.response?.data?.message ??
    axiosError.response?.data?.error ??
    (error instanceof Error ? error.message : 'Unknown error')
  );
}

function routeToFormValues(route: EventRoute): FormValues {
  return {
    sourceId: String(route.sourceId),
    eventClass: route.eventClass,
    upstreamEventType: route.upstreamEventType ?? '',
    objectTypes: route.objectTypes ?? [],
    targetType: route.bindingStatus === 'unresolved' ? '' : ((route.targetType ?? 'floodlight') as TargetType),
    targetId: route.targetId === null ? '' : String(route.targetId),
    bindingStatus: route.bindingStatus,
    enabled: route.enabled,
    notes: route.notes ?? '',
  };
}

function buildInput(values: FormValues): EventRouteInput {
  const targetId = values.targetId ? Number(values.targetId) : null;
  const hasTarget = values.bindingStatus === 'resolved' || (!!values.targetType && targetId !== null);
  const objectTypes = values.eventClass === 'motion' || values.objectTypes.length === 0 ? null : values.objectTypes;

  return {
    sourceType: 'protect_source',
    sourceId: Number(values.sourceId),
    eventClass: values.eventClass,
    upstreamEventType: values.upstreamEventType.trim() || null,
    objectTypes,
    bindingStatus: values.bindingStatus,
    targetType: hasTarget && values.targetType ? values.targetType : null,
    targetId: hasTarget ? targetId : null,
    enabled: values.enabled,
    notes: values.notes.trim() || null,
  };
}

function routeStatusBadge(route: EventRoute) {
  if (route.enabled) {
    return (
      <span className="inline-flex rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-200">
        Enabled
      </span>
    );
  }

  return (
    <span className="inline-flex rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-200">
      Disabled
    </span>
  );
}

export function EventRoutesPage() {
  const routesQuery = useEventRoutes();
  const sourcesQuery = useProtectSources();
  const targets = useRouteTargets();
  const createMutation = useCreateEventRoute();
  const updateMutation = useUpdateEventRoute();
  const deleteMutation = useDeleteEventRoute();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<FormValues>(defaultValues);
  const [actionMessage, setActionMessage] = useState<ActionMessage>(null);
  const [deleteRoute, setDeleteRoute] = useState<EventRoute | null>(null);

  useEffect(() => {
    if (formValues.sourceId || !sourcesQuery.data?.[0]) return;
    setFormValues((current) => ({ ...current, sourceId: String(sourcesQuery.data[0].id) }));
  }, [formValues.sourceId, sourcesQuery.data]);

  useEffect(() => {
    if (formValues.bindingStatus === 'unresolved' || !formValues.targetType) return;
    if (formValues.targetId) return;
    const list = formValues.targetType === 'group' ? targets.groups.data : targets.floodlights.data;
    if (!list?.[0]) return;
    setFormValues((current) => ({ ...current, targetId: String(list[0].id) }));
  }, [formValues.targetId, formValues.targetType, targets.floodlights.data, targets.groups.data]);

  const sourceById = useMemo(
    () => new Map((sourcesQuery.data ?? []).map((source) => [source.id, source])),
    [sourcesQuery.data],
  );
  const floodlightById = useMemo(
    () => new Map((targets.floodlights.data ?? []).map((target) => [target.id, target])),
    [targets.floodlights.data],
  );
  const groupById = useMemo(
    () => new Map((targets.groups.data ?? []).map((target) => [target.id, target])),
    [targets.groups.data],
  );
  const currentTargets = formValues.targetType === 'group' ? targets.groups.data ?? [] : targets.floodlights.data ?? [];
  const currentObjectTypes = objectTypesByClass[formValues.eventClass];

  function getRouteSourceLabel(route: EventRoute) {
    const source = sourceById.get(route.sourceId);
    return source ? `${source.name} (${source.protectCameraId})` : String(route.sourceId);
  }

  function getRouteTargetLabel(route: EventRoute) {
    const target = route.targetType === 'group'
      ? groupById.get(route.targetId ?? -1)
      : floodlightById.get(route.targetId ?? -1);

    return route.targetType && target ? `${route.targetType}: ${target.name}` : 'None';
  }

  function getRouteEventLabel(route: EventRoute) {
    return eventClassOptions.find((item) => item.value === route.eventClass)?.label ?? route.eventClass;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      const input = buildInput(formValues);
      if (editingId === null) {
        await createMutation.mutateAsync(input);
        setActionMessage({ type: 'success', text: 'Route created.' });
      } else {
        await updateMutation.mutateAsync({ id: editingId, input });
        setActionMessage({ type: 'success', text: 'Route updated.' });
      }

      setEditingId(null);
      setFormValues(defaultValues);
    } catch (error) {
      setActionMessage({ type: 'error', text: getErrorMessage(error) });
    }
  }

  function editRoute(route: EventRoute) {
    setEditingId(route.id);
    setFormValues(routeToFormValues(route));
  }

  async function removeRoute(id: number) {
    try {
      await deleteMutation.mutateAsync(id);
      if (editingId === id) {
        setEditingId(null);
        setFormValues(defaultValues);
      }
      setActionMessage({ type: 'success', text: 'Route deleted.' });
    } catch (error) {
      setActionMessage({ type: 'error', text: getErrorMessage(error) });
    } finally {
      setDeleteRoute(null);
    }
  }

  const loading = routesQuery.isLoading || sourcesQuery.isLoading || targets.floodlights.isLoading || targets.groups.isLoading;

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-white">Event Routes</h1>
      </header>

      {actionMessage ? (
        <p
          className={`rounded border px-3 py-2 text-sm ${
            actionMessage.type === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
          }`}
        >
          {actionMessage.text}
        </p>
      ) : null}

      {deleteRoute ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-md rounded border border-slate-700 bg-slate-900 p-4 shadow-xl">
            <h2 className="text-lg font-semibold text-white">Delete Route</h2>
            <p className="mt-2 text-sm text-slate-200">Delete this event route? This cannot be undone.</p>
            <dl className="mt-3 space-y-1 rounded border border-slate-800 bg-slate-950/60 p-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-400">Source</dt>
                <dd className="text-right text-slate-100">{getRouteSourceLabel(deleteRoute)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-400">Event</dt>
                <dd className="text-right text-slate-100">{getRouteEventLabel(deleteRoute)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-400">Target</dt>
                <dd className="text-right text-slate-100">{getRouteTargetLabel(deleteRoute)}</dd>
              </div>
            </dl>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-100"
                onClick={() => setDeleteRoute(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteMutation.isPending}
                className="rounded bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-700"
                onClick={() => void removeRoute(deleteRoute.id)}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete route'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <form className="grid gap-4 rounded border border-slate-800 bg-slate-900/70 p-4 lg:grid-cols-6" onSubmit={onSubmit}>
        <label className="space-y-1 lg:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Protect source</span>
          <select
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            value={formValues.sourceId}
            onChange={(event) => setFormValues((current) => ({ ...current, sourceId: event.target.value }))}
            required
          >
            <option value="" disabled>Select camera</option>
            {(sourcesQuery.data ?? []).map((source) => (
              <option key={source.id} value={source.id}>
                {source.name} ({source.protectCameraId})
              </option>
            ))}
          </select>
          {!sourcesQuery.isLoading && (sourcesQuery.data ?? []).length === 0 ? (
            <span className="block text-xs text-amber-200">No Protect sources found. Configure Protect API settings and run Sync Protect Sources.</span>
          ) : null}
        </label>

        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Event class</span>
          <select
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            value={formValues.eventClass}
            onChange={(event) => {
              const eventClass = event.target.value as EventClass;
              setFormValues((current) => ({
                ...current,
                eventClass,
                upstreamEventType: upstreamTypeByClass[eventClass].value,
                objectTypes: [],
              }));
            }}
          >
            {eventClassOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Upstream type</span>
          <select
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            value={formValues.upstreamEventType}
            onChange={(event) => setFormValues((current) => ({ ...current, upstreamEventType: event.target.value }))}
          >
            <option value={upstreamTypeByClass[formValues.eventClass].value}>{upstreamTypeByClass[formValues.eventClass].label}</option>
            <option value="">Any upstream type</option>
          </select>
        </label>

        <fieldset className="space-y-2 lg:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Object types</span>
          {formValues.eventClass === 'motion' ? (
            <p className="rounded border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-400">Object type selection is not used for motion routes.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {currentObjectTypes.map((objectType) => (
                <label key={objectType} className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={formValues.objectTypes.includes(objectType)}
                    onChange={(event) => {
                      setFormValues((current) => ({
                        ...current,
                        objectTypes: event.target.checked
                          ? [...current.objectTypes, objectType]
                          : current.objectTypes.filter((item) => item !== objectType),
                      }));
                    }}
                  />
                  {objectType}
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-400">Leave blank to match all object types for this event class.</p>
          <p className="text-xs text-slate-400">Selecting multiple object types means OR matching. Example: person + vehicle matches person OR vehicle.</p>
        </fieldset>

        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Target type</span>
          <select
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            value={formValues.targetType}
            onChange={(event) => setFormValues((current) => ({ ...current, targetType: event.target.value as TargetType, targetId: '' }))}
            disabled={formValues.bindingStatus === 'unresolved'}
          >
            {targetTypeOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>

        <label className="space-y-1 lg:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Target</span>
          <select
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            value={formValues.targetId}
            onChange={(event) => setFormValues((current) => ({ ...current, targetId: event.target.value }))}
            required={formValues.bindingStatus === 'resolved'}
            disabled={formValues.bindingStatus === 'unresolved'}
          >
            <option value="">No target</option>
            {currentTargets.map((target) => (
              <option key={target.id} value={target.id}>{target.name}</option>
            ))}
          </select>
          {currentTargets.length === 0 ? <span className="block text-xs text-amber-200">No {formValues.targetType || 'selected'} targets configured.</span> : null}
        </label>

        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Binding</span>
          <select
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            value={formValues.bindingStatus}
            onChange={(event) => {
              const bindingStatus = event.target.value as BindingStatus;
              setFormValues((current) => ({
                ...current,
                bindingStatus,
                enabled: bindingStatus === 'unresolved' ? false : current.enabled,
                targetType: bindingStatus === 'unresolved' ? '' : current.targetType || 'floodlight',
                targetId: bindingStatus === 'unresolved' ? '' : current.targetId,
              }));
            }}
          >
            {bindingStatusOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <span className="block text-xs text-slate-400">Resolved routes point to a real configured target and can execute. Unresolved routes are saved for later but cannot execute.</span>
        </label>

        <label className="space-y-1 pt-6 text-sm text-slate-200">
          <span className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={formValues.enabled}
            disabled={formValues.bindingStatus === 'unresolved'}
            onChange={(event) => setFormValues((current) => ({ ...current, enabled: event.target.checked }))}
          />
          Enabled
          </span>
          <span className="block text-xs text-slate-400">Only enabled + resolved routes can execute.</span>
        </label>

        <label className="space-y-1 lg:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</span>
          <input
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            value={formValues.notes}
            onChange={(event) => setFormValues((current) => ({ ...current, notes: event.target.value }))}
          />
        </label>

        <div className="flex items-end gap-2 lg:col-span-2">
          <button
            type="submit"
            disabled={createMutation.isPending || updateMutation.isPending}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            {editingId === null ? 'Create route' : 'Update route'}
          </button>
          {editingId !== null ? (
            <button
              type="button"
              className="rounded border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-100"
              onClick={() => {
                setEditingId(null);
                setFormValues(defaultValues);
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      {loading ? <p className="text-sm text-slate-300">Loading routes...</p> : null}

      <div className="overflow-x-auto rounded border border-slate-800">
        <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
          <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2">Route ID</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Event</th>
              <th className="px-3 py-2">Objects</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-950/60 text-slate-200">
            {(routesQuery.data ?? []).map((route) => {
              return (
                <tr key={route.id}>
                  <td className="px-3 py-2 font-mono text-xs text-slate-300">{route.id}</td>
                  <td className="px-3 py-2">{getRouteSourceLabel(route)}</td>
                  <td className="px-3 py-2">
                    {getRouteEventLabel(route)}
                    {route.upstreamEventType ? <span className="text-slate-500"> / {route.upstreamEventType}</span> : null}
                  </td>
                  <td className="px-3 py-2">{route.objectTypes?.length ? route.objectTypes.join(', ') : 'All'}</td>
                  <td className="px-3 py-2">{getRouteTargetLabel(route)}</td>
                  <td className="px-3 py-2">
                    <div className="space-y-1">
                      {routeStatusBadge(route)}
                      <div className="text-xs text-slate-500">{route.bindingStatus}</div>
                    </div>
                  </td>
                  <td className="space-x-2 px-3 py-2">
                    <button className="rounded border border-slate-600 px-2 py-1 text-xs" type="button" onClick={() => editRoute(route)}>
                      Edit
                    </button>
                    <button className="rounded border border-rose-500/60 px-2 py-1 text-xs text-rose-200" type="button" onClick={() => setDeleteRoute(route)}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
            {routesQuery.data?.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-slate-400" colSpan={7}>No routes configured.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
