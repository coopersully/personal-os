import { Badge } from "../../components/ui/badge.js";

const previews = [
  {
    device: "phone",
    workspace: "tasks",
    title: "make it happen.",
    description:
      "a finished film. a few final details. keep the next step close and the progress in view.",
    screenshot: "tasks-premiere.jpg",
    alt: "nohmi tasks on a phone, showing the premiere checklist with four completed tasks and four final steps",
    width: 1024,
    height: 1536,
  },
  {
    device: "laptop",
    workspace: "mail",
    title: "a little more room.",
    description:
      "the room is booked. the crew is paid. bring every conversation into the same place, and keep things moving.",
    screenshot: "mail-premiere.jpg",
    alt: "nohmi mail on a laptop, with a confirmed cinema booking and the filmmaker’s reply",
    width: 1536,
    height: 1024,
  },
  {
    device: "monitor",
    workspace: "calendar",
    title: "see the shape of your week.",
    description:
      "from the final edit to opening night. give the important things time—and leave a little room to breathe.",
    screenshot: "calendar-premiere.jpg",
    alt: "nohmi calendar on a monitor, showing the final production sessions, premiere, and time with the crew",
    width: 1536,
    height: 1024,
  },
  {
    device: "tablet",
    workspace: "finances",
    title: "room for what’s next.",
    description:
      "know what came in, what went out, and what’s still yours. finish the project with your next move in sight.",
    screenshot: "finances-premiere.jpg",
    alt: "nohmi finances on a tablet, showing the film grant, freelance income, and settled production expenses",
    width: 1536,
    height: 1024,
  },
] as const;

function DeviceArtwork({ device }: { device: (typeof previews)[number]["device"] }) {
  const preview = previews.find((item) => item.device === device);
  if (!preview) return null;
  return (
    <div className={`public-device public-device--${device}`}>
      <img
        className="public-device__body"
        src={`/brand/devices/${device}-v2.webp`}
        width={preview.width}
        height={preview.height}
        alt=""
        loading="lazy"
        decoding="async"
      />
      <img
        className="public-device__screen"
        src={`/brand/devices/${preview.screenshot}`}
        alt={preview.alt}
        loading="lazy"
        decoding="async"
      />
    </div>
  );
}

function StoryFinale() {
  return (
    <section className="public-story-finale" aria-labelledby="story-finale-heading">
      <div className="public-product-preview__copy">
        <Badge variant="secondary" className="public-glass-badge">
          agent texting
        </Badge>
        <h2 id="story-finale-heading">you made the film.</h2>
        <p>from the first plan to opening night. your agent keeps the loose ends together.</p>
      </div>
      <div className="public-finale-scene">
        <div className="public-finale-figure" aria-hidden="true">
          <img
            src="/brand/nohmi-open-arms.webp"
            width={1310}
            height={1200}
            alt=""
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className="public-agent-conversation">
          <p className="public-agent-message">
            your goal was to finish a film and share it with an audience. you did it.
          </p>
          <p className="public-agent-message">
            your production budget is reconciled. one email still needs your reply: the cinema wants
            to screen it again.
          </p>
          <p className="public-agent-message">want me to draft a thank-you to the crew?</p>
          <p className="public-agent-message public-agent-message--you">
            yes. and keep tomorrow morning clear.
          </p>
          <p className="public-agent-message">
            i’ll prepare the draft for your review. tomorrow morning stays yours.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Real fixture screenshots stay separate from the decorative, replaceable device artwork. */
export function ProductPreviews() {
  return (
    <div className="public-product-previews">
      {previews.map(({ device, workspace, title, description, screenshot }) => (
        <section
          key={device}
          className={`public-product-preview public-product-preview--${device}`}
          aria-labelledby={`preview-${workspace}`}
        >
          <div className="public-product-preview__copy">
            <Badge variant="secondary" className="public-glass-badge">
              {workspace}
            </Badge>
            <h2 id={`preview-${workspace}`}>{title}</h2>
            <p>{description}</p>
            <a href={`/brand/devices/${screenshot}`}>view {workspace} screen</a>
          </div>
          <figure className="public-product-preview__stage">
            <DeviceArtwork device={device} />
            <div
              className={`public-figure-overlay public-figure-overlay--${device}`}
              aria-hidden="true"
            >
              <img
                src={`/brand/devices/figure-${device}-v2.webp`}
                alt=""
                loading="lazy"
                decoding="async"
                width={device === "laptop" || device === "monitor" ? 1024 : 1536}
                height={device === "laptop" || device === "monitor" ? 1536 : 1024}
              />
            </div>
          </figure>
        </section>
      ))}
      <StoryFinale />
    </div>
  );
}
