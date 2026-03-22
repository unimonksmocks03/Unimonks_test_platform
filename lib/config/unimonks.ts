const contactAddress =
  '2nd Floor, Chhabra Complex, Opp. Canara Bank, Laxmi Nagar Market, Munirka, New Delhi, Delhi 110067'

export const UNIMONKS_BRAND = {
  shortName: 'UNIMONKS',
  displayName: 'UNIMONKS CUET Coaching',
  tagline: 'CUET Coaching',
  websiteUrl: 'https://unimonks.co.in',
  websiteLabel: 'unimonks.co.in',
  logoAlt: 'UNIMONKS logo',
  logoPath: '/unimonks.png',
} as const

export const UNIMONKS_CONTACT = {
  phoneDisplay: '(+91) 99106 14532',
  phoneE164: '+919910614532',
  phoneHref: 'tel:+919910614532',
  email: 'info@unimonks.com',
  emailHref: 'mailto:info@unimonks.com',
  addressDisplay: contactAddress,
  locationLabel: 'Munirka, New Delhi, Delhi 110067',
  websiteUrl: UNIMONKS_BRAND.websiteUrl,
  websiteLabel: UNIMONKS_BRAND.websiteLabel,
  mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contactAddress)}`,
  addressStructuredData: {
    '@type': 'PostalAddress',
    streetAddress: '2nd Floor, Chhabra Complex, Opp. Canara Bank, Laxmi Nagar Market, Munirka',
    addressLocality: 'New Delhi',
    addressRegion: 'Delhi',
    postalCode: '110067',
    addressCountry: 'IN',
  },
} as const
