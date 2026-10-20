import { useMemo, useState } from 'react';
import { RegistrySelect } from '../ui/controls';
import { DataState } from '../ui/DataState';
import { Card, EmptyState, InfoBanner, SkeletonCard } from '../ui/primitives';
import { useDistricts, useLatestMandiObservations } from '../../services/agri';
import { formatCount, formatDate } from '../../services/agri/format';
import { HistoricalBadge, LatestObservationCard, LoadMore } from './historical';

/**
 * "Latest by mandi": each mandi's OWN latest available historical observation of one commodity
 * (`GET /api/v1/mandi-prices/latest`). Every mandi is shown with its own last-reported date; the
 * list is alphabetical by mandi name (the server's stable order) and is never a ranking. It is
 * historical data, not a live feed, and a mandi with no observation of the commodity is simply
 * absent: nothing is borrowed from state-level data.
 *
 * @param {{ coverage: any | null, states: { status: string, data: any }, catalogue: { status: string, data: any }, initialCommodityId?: string }} props
 */
export function LatestByMandiView({ coverage, states, catalogue, initialCommodityId = '' }) {
  const [commodityId, setCommodityId] = useState(initialCommodityId);
  const [stateId, setStateId] = useState('');
  const [districtId, setDistrictId] = useState('');

  const mandiCommodities = useMemo(
    () =>
      catalogue.status === 'ready'
        ? catalogue.data.items.filter((c) => c.coverage.mandi_daily.observations > 0)
        : [],
    [catalogue],
  );
  const commodity = mandiCommodities.find((c) => c.id === commodityId) ?? null;
  const districts = useDistricts(stateId);
  const latest = useLatestMandiObservations({
    commodityId: commodity ? commodityId : '',
    stateId,
    districtId,
  });
  const referenceDate = latest.meta?.reference_date ?? null;

  const stateOptions =
    states.status === 'ready' ? states.data.items.map((s) => ({ value: s.id, label: s.name })) : [];
  const stateName = stateOptions.find((o) => o.value === stateId)?.label;
  const districtOptions =
    districts.status === 'ready'
      ? districts.data.items.map((d) => ({ value: d.id, label: d.name }))
      : [];
  const districtName = districtOptions.find((o) => o.value === districtId)?.label;

  return (
    <div className="flex flex-col gap-space-md">
      <InfoBanner icon="history">
        This view shows each mandi’s own latest available observation of one commodity, from the
        historical files. It is not a live feed and it is not a ranking: mandis are listed
        alphabetically, and different mandis last reported on different dates.
      </InfoBanner>

      <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-3">
        <RegistrySelect
          label="Commodity"
          placeholder="Select a commodity"
          unavailable={catalogue.status !== 'ready'}
          options={mandiCommodities.map((c) => ({ value: c.id, label: c.name }))}
          value={commodityId}
          onChange={setCommodityId}
        />
        <RegistrySelect
          label="State"
          placeholder="All states"
          unavailable={states.status !== 'ready'}
          options={stateOptions}
          value={stateId}
          onChange={(value) => {
            setStateId(value);
            setDistrictId('');
          }}
        />
        <RegistrySelect
          label="District"
          placeholder={stateId ? 'All districts' : 'Choose a state first'}
          unavailable={districts.status !== 'ready'}
          options={districtOptions}
          value={districtId}
          onChange={setDistrictId}
        />
      </div>
      {catalogue.status === 'ready' ? (
        <p className="font-label-xs text-label-xs text-on-surface-variant">
          Only {mandiCommodities.length} of {catalogue.data.items.length} commodities have
          mandi-level observations. A mandi that never reported the chosen commodity is not listed.
        </p>
      ) : null}

      <Card aria-labelledby="latest-heading" className="flex flex-col gap-space-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="latest-heading" className="font-headline-sm text-headline-sm font-extrabold">
            Latest available observation per mandi
          </h2>
          <HistoricalBadge>Latest available · not live</HistoricalBadge>
        </div>
        <p className="font-label-xs text-label-xs text-on-surface-variant">
          {commodity ? `Commodity: ${commodity.name}. ` : ''}
          {stateName ? `State: ${stateName}. ` : ''}
          {districtName ? `District: ${districtName}. ` : ''}
          Prices are modal prices in INR per quintal; the file states no unit, so the unit is an
          assumption. Dates are the dates in the source files; they are not the date of this
          request.
          {referenceDate
            ? ` Reference date: ${formatDate(referenceDate)}, the newest observation among the mandis listed here (not today).`
            : ''}
        </p>
        <DataState
          state={{
            status: latest.status,
            data: latest.items,
            reason: latest.reason,
            needs: '',
            retry: latest.retry,
          }}
          icon="storefront"
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
                message="No mandi has an observation of this commodity for these filters. State-level prices are not shown in their place."
              />
            ) : (
              <div className="flex flex-col gap-space-sm">
                <p className="font-label-xs text-label-xs text-on-surface-variant">
                  {formatCount(rows.length)} {rows.length === 1 ? 'mandi' : 'mandis'} loaded
                  {latest.pagination?.has_more ? ' so far' : ''}, listed alphabetically.
                </p>
                {rows.map((row) => (
                  <LatestObservationCard
                    key={row.market.id}
                    row={row}
                    referenceDate={referenceDate}
                  />
                ))}
                <LoadMore pager={latest} noun="mandis" />
              </div>
            )
          }
        </DataState>
        {coverage ? (
          <p className="font-label-xs text-label-xs text-outline">
            Mandi-level data in the files runs from{' '}
            {formatDate(coverage.granularities.mandi_daily.first_date)} to{' '}
            {formatDate(coverage.granularities.mandi_daily.last_date)}.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
