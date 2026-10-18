import { RegistrySelect } from '../components/ui/controls';
import { Card, InfoBanner, PageHeader, PreviewBadge } from '../components/ui/primitives';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/**
 * Profile and preferences placeholder. There is no sign-in and nothing is stored: every control
 * is disabled and says why.
 */
export function ProfilePage() {
  useDocumentTitle('Profile');
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-space-md">
      <PageHeader
        icon="person"
        title="Profile and preferences"
        subtitle="Your location, language and crops will be set here."
        badge={<PreviewBadge>UI preview</PreviewBadge>}
      />
      <InfoBanner icon="lock">
        Sign-in and saved preferences are not available yet. Nothing on this page is stored.
      </InfoBanner>

      <Card aria-labelledby="location-heading" className="flex flex-col gap-space-sm">
        <h2 id="location-heading" className="font-headline-sm text-headline-sm font-extrabold">
          Location
        </h2>
        <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-2">
          <RegistrySelect label="State" placeholder="Select a state" />
          <RegistrySelect label="District" placeholder="Select a district" />
        </div>
      </Card>

      <Card aria-labelledby="language-heading" className="flex flex-col gap-space-sm">
        <h2 id="language-heading" className="font-headline-sm text-headline-sm font-extrabold">
          Language
        </h2>
        <div role="group" aria-label="Language" className="flex flex-wrap gap-space-xs">
          <button
            type="button"
            aria-pressed="true"
            className="min-h-[44px] rounded-xl bg-primary-container px-4 font-label-md text-label-md font-bold text-on-primary"
          >
            English
          </button>
          <button
            type="button"
            disabled
            className="min-h-[44px] cursor-not-allowed rounded-xl bg-surface-container-high px-4 font-label-md text-label-md text-outline"
          >
            हिन्दी (not available yet)
          </button>
          <button
            type="button"
            disabled
            className="min-h-[44px] cursor-not-allowed rounded-xl bg-surface-container-high px-4 font-label-md text-label-md text-outline"
          >
            मराठी (not available yet)
          </button>
        </div>
      </Card>

      <Card aria-labelledby="crops-heading" className="flex flex-col gap-space-sm">
        <h2 id="crops-heading" className="font-headline-sm text-headline-sm font-extrabold">
          My commodities
        </h2>
        <RegistrySelect label="Add a commodity" placeholder="Select a commodity" />
      </Card>

      <Card aria-labelledby="notify-heading" className="flex flex-col gap-space-sm">
        <h2 id="notify-heading" className="font-headline-sm text-headline-sm font-extrabold">
          Alerts
        </h2>
        <label className="flex min-h-[44px] items-center gap-space-sm font-body-md text-body-md text-on-surface-variant">
          <input type="checkbox" disabled className="h-5 w-5" />
          Price and weather alerts (not available yet)
        </label>
      </Card>
    </div>
  );
}
