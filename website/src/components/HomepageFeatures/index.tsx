import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  description: React.JSX.Element;
  icon: string;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Node.js APIs',
    icon: '🖥',
    description: (
      <>
        40 modules: fs, net, http, crypto, stream, events, and more.
        Backed by GLib, Gio, and Soup — running natively on GNOME.
      </>
    ),
  },
  {
    title: 'Web APIs',
    icon: '🌐',
    description: (
      <>
        fetch, WebSocket, AbortController, FormData, Streams, and more.
        Standard browser APIs available in GJS, powered by Soup 3.0.
      </>
    ),
  },
  {
    title: 'DOM & Graphics',
    icon: '🎨',
    description: (
      <>
        Canvas2D via Cairo, WebGL via OpenGL ES, DOM elements as GTK widgets,
        and a full GTK→DOM event bridge.
      </>
    ),
  },
];

function Feature({title, icon, description}: FeatureItem) {
  return (
    <div className={styles.featureCard}>
      <div className={styles.featureIcon}>{icon}</div>
      <div>
        <Heading as="h3" className={styles.featureTitle}>{title}</Heading>
        <p className={styles.featureDescription}>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): React.JSX.Element {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.featureGrid}>
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
