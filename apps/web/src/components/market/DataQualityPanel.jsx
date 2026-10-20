import { useState } from 'react';
import { DataState } from '../ui/DataState';
import { MaterialIcon } from '../ui/MaterialIcon';
import { useSources, useUnresolvedGeography } from '../../services/agri';
import { formatCount, formatDate, formatMonth } from '../../services/agri/format';
import { Chip } from './historical';

/**
 * "Data quality and coverage": everything the API says about how far the historical data can be
 * trusted, in one place. Facts come from the API (`/coverage`, `/states`, `/sources`,
 * `/geography/unresolved`); nothing is verified, normalised or softened here. The two heavier
 * requests (sources, unresolved labels) are made only when the panel is opened.
 *
 * @param {{ coverage: any | null, states: any[] }} props `coverage` is `/coverage` data, or null
 *   while it loads; `states` is the `/states` list (used for provisional mappings).
 */
export function DataQualityPanel({ coverage, states }) {
  const [open, setOpen] = useState(false);
  const sources = useSources(open);
  const unresolved = useUnresolvedGeography(open);
  const g = coverage?.granularities;
  const geo = coverage?.geography;
  const provisional = states.flatMap((s) =>
    (s.source_labels ?? [])
      .filter((l) => l.mapping_status === 'provisional')
      .map((l) => ({ ...l, state: s.name })),
  );

  return (
    <details
      className="group rounded-2xl bg-surface-container-low p-space-md"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 font-headline-sm text-headline-sm font-bold text-on-surface [&::-webkit-details-marker]:hidden">
        <MaterialIcon name="fact_check" className="text-primary" />
        <span className="flex-1">Data quality and coverage</span>
        <MaterialIcon name="expand_more" className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-space-sm flex flex-col gap-space-sm font-body-sm text-body-sm text-on-surface-variant">
        {!coverage ? (
          <p>The coverage summary has not loaded.</p>
        ) : (
          <>
            <section aria-labelledby="dq-latest" className="flex flex-col gap-1">
              <h3 id="dq-latest" className="font-label-md text-label-md font-bold text-on-surface">
                Latest available observations (not live)
              </h3>
              <ul className="list-disc pl-5">
                <li>
                  Mandi-level daily: {formatDate(g.mandi_daily.first_date)} to{' '}
                  {formatDate(g.mandi_daily.last_date)} ({formatCount(g.mandi_daily.observations)}{' '}
                  observations, {g.mandi_daily.states} states)
                </li>
                <li>
                  State-level daily: {formatDate(g.state_daily.first_date)} to{' '}
                  {formatDate(g.state_daily.last_date)} ({formatCount(g.state_daily.observations)}{' '}
                  observations, {g.state_daily.states} states)
                </li>
                <li>
                  National monthly: {formatMonth(g.national_monthly.first_month)} to{' '}
                  {formatMonth(g.national_monthly.last_month)}
                </li>
              </ul>
              <p>
                These are the newest records in the imported files, not a live feed. A date being
                the latest available says nothing about whether a market still trades.
              </p>
            </section>

            <section aria-labelledby="dq-geo" className="flex flex-col gap-1">
              <h3 id="dq-geo" className="font-label-md text-label-md font-bold text-on-surface">
                Geography and market identity
              </h3>
              <ul className="list-disc pl-5">
                <li>
                  <strong>
                    All {formatCount(geo.markets_unverified)} of{' '}
                    {formatCount(coverage.registry.markets)} mandis are unverified.
                  </strong>{' '}
                  Their identities come from the labels in the files; no authoritative market list
                  exists.
                </li>
                <li>
                  {formatCount(geo.markets_with_unresolved_district)} mandis (
                  {formatCount(geo.mandi_observations_in_unresolved_district_markets)} observations)
                  have a district that could not be resolved; {geo.unresolved_district_labels}{' '}
                  district labels are unresolved. They keep the label the file used.
                </li>
                <li>
                  The state and district reference is a provisional December 2022 mirror, not a
                  verified current registry.
                </li>
              </ul>
              {provisional.map((l) => (
                <p key={`${l.source_code}-${l.source_label}`}>
                  <Chip icon="rule" tone="caution">
                    Provisional mapping
                  </Chip>{' '}
                  “{l.source_label}” is mapped to {l.state} by a reviewed decision, pending
                  authoritative confirmation.
                </p>
              ))}
              {geo.unresolved_state_labels > 0 ? (
                <p>
                  {geo.unresolved_state_labels} state label stays unresolved and its rows are
                  excluded.
                </p>
              ) : null}
              {open ? (
                <DataState
                  state={{
                    status: unresolved.status,
                    data: unresolved.data,
                    reason: unresolved.reason,
                    needs: '',
                    retry: unresolved.retry,
                  }}
                  skeleton={<p>Loading the unresolved labels…</p>}
                >
                  {(data) => (
                    <div className="flex flex-col gap-1">
                      {data.states.map((s) => (
                        <p key={s.source_label}>
                          State label “{s.source_label}”: unresolved,{' '}
                          {formatCount(s.rows_quarantined)} rows quarantined (not mapped to any
                          state).
                        </p>
                      ))}
                      <p className="font-label-md text-label-md font-bold text-on-surface">
                        Unresolved district labels ({data.districts.length})
                      </p>
                      <ul className="max-h-48 list-disc overflow-y-auto pl-5">
                        {data.districts.map((d) => (
                          <li key={`${d.source_state_label}-${d.source_district_label}`}>
                            “{d.source_district_label}” ({d.source_state_label}):{' '}
                            {formatCount(d.observations)} observations, {d.markets} mandis
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </DataState>
              ) : null}
            </section>

            <section aria-labelledby="dq-units" className="flex flex-col gap-1">
              <h3 id="dq-units" className="font-label-md text-label-md font-bold text-on-surface">
                Units
              </h3>
              <ul className="list-disc pl-5">
                <li>
                  Mandi-level prices: INR per quintal is an <strong>assumption</strong>; the source
                  file states no unit.
                </li>
                <li>
                  State-level data: units are stated per row by the source and are mixed (prices per
                  quintal, bundle or unit; arrivals in tonnes, bundles or pieces). Count units are
                  never converted to weight.
                </li>
              </ul>
            </section>

            <section aria-labelledby="dq-limits" className="flex flex-col gap-1">
              <h3 id="dq-limits" className="font-label-md text-label-md font-bold text-on-surface">
                Coverage limitations
              </h3>
              <ul className="list-disc pl-5">
                <li>
                  Only {g.mandi_daily.commodities} of {formatCount(coverage.registry.commodities)}{' '}
                  commodities have mandi-level observations; mandi data covers{' '}
                  {g.mandi_daily.states} of {coverage.registry.states} states and union territories.
                </li>
                <li>
                  State-level observations cover {g.state_daily.commodities} commodities in{' '}
                  {g.state_daily.states} states and describe a state as a whole.
                </li>
                <li>A missing mandi price is never filled from state or national data.</li>
              </ul>
            </section>

            {open ? (
              <section aria-labelledby="dq-sources" className="flex flex-col gap-1">
                <h3
                  id="dq-sources"
                  className="font-label-md text-label-md font-bold text-on-surface"
                >
                  Sources and provenance
                </h3>
                <DataState
                  state={{
                    status: sources.status,
                    data: sources.data,
                    reason: sources.reason,
                    needs: '',
                    retry: sources.retry,
                  }}
                  skeleton={<p>Loading the sources…</p>}
                >
                  {(list) => (
                    <ul className="flex flex-col gap-space-xs">
                      {list
                        .filter((s) => s.observations)
                        .map((s) => (
                          <li
                            key={s.code}
                            className="rounded-xl bg-surface-container-lowest p-space-sm"
                          >
                            <p className="font-label-md text-label-md font-bold text-on-surface">
                              {s.code}
                            </p>
                            <p>
                              {s.files
                                .map((f) => `${f.file_name} (SHA-256 ${f.sha256.slice(0, 12)}…)`)
                                .join(', ')}
                            </p>
                            <p>
                              {formatCount(s.observations.count)} observations from{' '}
                              {formatDate(s.observations.first_date)} to{' '}
                              {formatDate(s.observations.last_date)}
                              {s.initial_load
                                ? `; loaded with importer ${s.initial_load.importer_version}: ${formatCount(s.initial_load.accepted)} accepted, ${formatCount(s.initial_load.quarantined)} quarantined`
                                : ''}
                            </p>
                            {s.assumptions.length ? (
                              <ul className="list-disc pl-5">
                                {s.assumptions.map((a) => (
                                  <li key={a.code}>{a.statement}</li>
                                ))}
                              </ul>
                            ) : null}
                          </li>
                        ))}
                    </ul>
                  )}
                </DataState>
              </section>
            ) : null}
          </>
        )}
      </div>
    </details>
  );
}
