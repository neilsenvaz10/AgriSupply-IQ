import { useMemo, useState } from 'react';
import { RegistrySelect } from '../ui/controls';
import { DataState } from '../ui/DataState';
import { SearchableSelect } from '../ui/SearchableSelect';
import { Card, EmptyState, InfoBanner, SkeletonCard } from '../ui/primitives';
import { useStateObservations } from '../../services/agri';
import { addDays, formatCount, formatDate, formatRange } from '../../services/agri/format';
import { MAX_RANGE_DAYS, spanDays } from '../../services/agri/historical';
import { HistoricalBadge, LoadMore, StateObservationCard, WindowControls } from './historical';

const WINDOW_DAYS = 90;

/**
 * Historical STATE-level prices and arrivals (`/api/v1/state-prices`), kept in a view of their own.
 * A state-level row describes a state as a whole: it is never listed among mandi observations,
 * never used to fill a missing mandi price, and is labelled as state-level everywhere. Units are
 * shown as the source stated them and are never converted.
 *
 * @param {{ coverage: any | null, states: { status: string, data: any, reason: string }, catalogue: { status: string, data: any } }} props
 */
export function StatePricesView({ coverage, states, catalogue }) {
  const [stateId, setStateId] = useState('');
  const [commodityId, setCommodityId] = useState('');
  const [windowEdit, setWindowEdit] = useState(
    /** @type {{ from: string, to: string } | null} */ (null),
  );

  const items = useMemo(
    () => (catalogue.status === 'ready' ? catalogue.data.items : []),
    [catalogue],
  );
  const stateCommodities = useMemo(
    () => items.filter((c) => c.coverage.state_daily.observations > 0),
    [items],
  );
  const options = useMemo(
    () =>
      stateCommodities.map((c) => ({
        value: c.id,
        label: c.name,
        description: `State-level: ${formatCount(c.coverage.state_daily.observations)} observations, ${formatRange(c.coverage.state_daily)}`,
      })),
    [stateCommodities],
  );
  const commodity = stateCommodities.find((c) => c.id === commodityId) ?? null;

  // The latest day with state-level data for the selection: the commodity's own, else the file's.
  // End of the default window: only a convenient place to start looking, not a claim.
  const windowEnd = commodity
    ? commodity.coverage.state_daily.last_date
    : (coverage?.granularities.state_daily.last_date ?? null);
  // The "latest day" shortcut is offered only when the API's summary data proves it for the exact
  // filters: a commodity on its own. With a state chosen, the summary cannot say which day was the
  // latest for that state, so no shortcut is offered and nothing is guessed from the file-wide maximum.
  const latestDay = !stateId && commodity ? commodity.coverage.state_daily.last_date : null;
  const defaultWindow = windowEnd
    ? { from: addDays(windowEnd, -(WINDOW_DAYS - 1)), to: windowEnd }
    : null;
  const win = windowEdit ?? defaultWindow;
  const windowValid = Boolean(
    win && win.from && win.to && win.from <= win.to && spanDays(win.from, win.to) <= MAX_RANGE_DAYS,
  );

  const observations = useStateObservations(
    { stateId, commodityId, from: win?.from ?? '', to: win?.to ?? '' },
    { enabled: windowValid },
  );
  const stateOptions =
    states.status === 'ready' ? states.data.items.map((s) => ({ value: s.id, label: s.name })) : [];
  const stateName = stateOptions.find((o) => o.value === stateId)?.label;

  return (
    <div className="flex flex-col gap-space-md">
      <InfoBanner icon="public">
        State-level prices describe a state as a whole, from separate historical report files. They
        are not prices in any mandi, are never shown among mandi observations, and are never used to
        fill a missing mandi price.
      </InfoBanner>

      <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-2">
        <RegistrySelect
          label="State"
          placeholder="All states"
          unavailable={states.status !== 'ready'}
          options={stateOptions}
          value={stateId}
          onChange={setStateId}
        />
        <SearchableSelect
          label="Commodity"
          placeholder="Search commodities…"
          options={options}
          value={commodityId}
          onChange={(value) => {
            setCommodityId(value);
            setWindowEdit(null);
          }}
          disabled={catalogue.status !== 'ready'}
          disabledNote="Loading the commodity catalogue…"
          emptyMessage="No commodity with state-level observations matches this search."
          hint={
            catalogue.status === 'ready'
              ? `${formatCount(stateCommodities.length)} of ${formatCount(items.length)} commodities have state-level observations.`
              : ''
          }
        />
      </div>

      <Card aria-labelledby="state-prices-heading" className="flex flex-col gap-space-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="state-prices-heading"
            className="font-headline-sm text-headline-sm font-extrabold"
          >
            Historical state-level prices
          </h2>
          <HistoricalBadge>State-level · not live</HistoricalBadge>
        </div>
        <p className="font-label-xs text-label-xs text-on-surface-variant">
          {stateName ? `State: ${stateName}. ` : ''}
          {commodity ? `Commodity: ${commodity.name}. ` : ''}
          Prices and arrivals are shown in the units the source stated for each row (they are
          mixed); arrivals are never converted, and count units (bundles, pieces) are not
          convertible to weight.
        </p>
        {stateId && windowEnd ? (
          <p className="font-label-xs text-label-xs text-on-surface-variant">
            The latest day for this state is not available from the API’s summary data, so no
            “latest day” shortcut is offered; the default window ends at {formatDate(windowEnd)}.
            Set the dates to look elsewhere.
          </p>
        ) : null}
        {win ? (
          <WindowControls
            from={win.from}
            to={win.to}
            onChange={setWindowEdit}
            minDate={coverage?.granularities.state_daily.first_date}
            maxDate={coverage?.granularities.state_daily.last_date}
            latestDay={latestDay}
            onReset={() => setWindowEdit(null)}
          />
        ) : null}
        <DataState
          state={{
            status: observations.status,
            data: observations.items,
            reason: observations.reason,
            needs: '',
            retry: observations.retry,
          }}
          icon="payments"
          skeleton={
            <div className="grid gap-space-sm">
              <SkeletonCard lines={2} />
              <SkeletonCard lines={2} />
            </div>
          }
        >
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState
                icon="event_busy"
                message={`No state-level observations exist for these filters between ${formatDate(win?.from)} and ${formatDate(win?.to)}. Mandi prices are not shown in their place.`}
              />
            ) : (
              <div className="flex flex-col gap-space-sm">
                {rows.map((row) => (
                  <StateObservationCard key={row.id} row={row} />
                ))}
                <LoadMore pager={observations} noun="observations" />
              </div>
            )
          }
        </DataState>
      </Card>
    </div>
  );
}
