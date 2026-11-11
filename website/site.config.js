// Single source of truth for site-wide SEO and business facts.
// Everything here feeds <head> tags, JSON-LD, the footer, sitemap.xml,
// robots.txt and llms.txt at build time. Leave a value empty and the
// tags that need it are left out (nothing is ever guessed).
export default {
  name: 'Tales of Biryani',
  tagline: 'Dum biryani, cooked the slow way.',

  // Production origin, no trailing slash, e.g. 'https://talesofbiryani.in'.
  // Required for canonical tags, sitemap.xml, og:url/og:image and breadcrumb schema.
  url: '',

  locale: 'en_IN',
  themeColor: '#190019',

  // Local business details (schema.org Restaurant + footer).
  business: {
    telephone: '',        // '+91 98xxxxxxxx'
    streetAddress: '',
    addressLocality: '',  // city
    addressRegion: '',    // state
    postalCode: '',
    addressCountry: 'IN',
    openingHours: [],     // schema.org format, e.g. ['Mo-Su 11:00-23:00']
  },
};
