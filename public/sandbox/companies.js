// Sample companies for the demo sandbox. /<key> (e.g. /demo, /indoco) loads one of these into its
// own in-browser database. People and trips are fictional.
//
// Every company has the same cast, addressed by role key:
//   hr (admin, books tickets) · zonal (approves the manager's and the PM's trips)
//   manager (approves the field team) · hero (the traveller prospects play) · rep1, rep2 · pm
// and the same five sample trips: an urgent trip awaiting approval, an approved group trip waiting
// to be booked, a booked flight with tickets, a past booked trip, and a rejected out-of-policy flight.

const person = (name, title, grade, role, dept, manager, details) => ({ name, title, grade, role, dept, manager, details });

const BASE = {
  demo: {
    company: 'Sunrise Pharma Ltd',
    domain: 'sunrisepharma.demo',
    title: 'Try TravelDesk',
    intro: 'No sign-up. Step into Sunrise Pharma Ltd, a sample company, and switch roles any time.',
    footer: 'Sunrise Pharma Ltd is a fictional company · TravelDesk demo',
    people: {
      hr: person('Neha Kapoor', 'HR & Travel Desk', 'L5', 'admin', 'Human Resources', null, null),
      zonal: person('Vikram Rao', 'Zonal Sales Head', 'L7', 'manager', 'Sales', null, null),
      manager: person('Arjun Mehta', 'Regional Sales Manager', 'L6', 'manager', 'Sales', 'zonal', ['male', '1988-06-30', '98200 99001', 'Non-vegetarian', 'Lower']),
      hero: person('Priya Sharma', 'Area Sales Executive', 'L2', 'employee', 'Sales', 'manager', ['female', '1996-04-12', '98200 11223', 'Vegetarian', 'Lower']),
      rep1: person('Rahul Verma', 'Medical Representative', 'L1', 'employee', 'Sales', 'manager', ['male', '1998-09-03', '98200 44556', 'Non-vegetarian', 'Upper']),
      rep2: person('Kavita Iyer', 'Medical Representative', 'L1', 'employee', 'Sales', 'manager', ['female', '1997-01-21', '98200 77889', 'Vegetarian', 'Lower']),
      pm: person('Sameer Khan', 'Product Manager', 'L4', 'employee', 'Marketing', 'zonal', ['male', '1991-11-08', '98200 33445', 'Non-vegetarian', 'Side lower']),
    },
    hotels: [
      ['mumbai', 'Hotel Sahara Star Business', 'Vile Parle East, near airport', 2400, true, 'Corporate code SUNRISE'],
      ['mumbai', 'Ginger Andheri', 'Andheri East (MIDC)', 1900, false, ''],
      ['delhi', 'Lemon Tree Premier', 'Aerocity', 2450, true, 'Airport shuttle included'],
      ['delhi', 'Treebo Trend Paharganj', 'Near New Delhi station', 1450, false, ''],
      ['ahmedabad', 'Fortune Park', 'Ashram Road', 1950, true, ''],
      ['nagpur', 'Hotel Centre Point', 'Ramdaspeth', 1400, true, 'Close to medical college'],
      ['patna', 'Hotel Maurya', 'Gandhi Maidan', 1950, true, ''],
      ['pune', 'Ibis Viman Nagar', 'Viman Nagar', 1850, true, ''],
      ['lucknow', 'Hotel Clarks Avadh', 'Mahatma Gandhi Marg', 1750, true, ''],
    ],
    trips: ({ d, seg }) => [
      { by: 'rep1', trip: { title: 'Pune → Nagpur · CME', purpose: 'Doctor meetings and CME sponsorship at GMC Nagpur', origin: 'Pune', destination: 'Nagpur',
          start_date: d(4), end_date: d(6), is_urgent: true, urgency_reason: 'CME date was moved up by the organisers',
          justification: 'Short notice: dates confirmed by the hospital this week' },
        segments: [
          seg('train', 'Pune', 'Nagpur', d(4), { travel_class: 'sleeper', notes: 'Preferred: Night · No. 12135' }),
          seg('hotel', '', 'Nagpur', d(4), { end_date: d(6), notes: 'Hotel Centre Point' }),
          seg('train', 'Nagpur', 'Pune', d(6), { travel_class: 'sleeper', notes: 'Preferred: Evening' }),
        ] },
      { by: 'rep2', with: ['rep1'], trip: { title: 'Mumbai → Ahmedabad · Stockist meet', purpose: 'Quarterly stockist meet, Gujarat region', origin: 'Mumbai', destination: 'Ahmedabad',
          start_date: d(35), end_date: d(36) },
        segments: [
          seg('train', 'Mumbai', 'Ahmedabad', d(35), { travel_class: 'sleeper', notes: 'Preferred: Early morning · No. 12009' }),
          seg('hotel', '', 'Ahmedabad', d(35), { end_date: d(36), rooms: 2, notes: 'Fortune Park' }),
          seg('train', 'Ahmedabad', 'Mumbai', d(36), { travel_class: 'sleeper', notes: 'Preferred: Evening' }),
        ],
        decide: ['manager', 'approve', 'Approved. Please carry the Q3 scheme sheets.'] },
      { by: 'pm', trip: { title: 'Mumbai → Delhi · Brand launch', purpose: 'North zone launch of CardioSun range', origin: 'Mumbai', destination: 'Delhi',
          start_date: d(40), end_date: d(42) },
        segments: [
          seg('flight', 'Mumbai', 'Delhi', d(40), { notes: 'Preferred: Morning' }),
          seg('hotel', '', 'Delhi', d(40), { end_date: d(42), notes: 'Lemon Tree Premier, Aerocity' }),
          seg('flight', 'Delhi', 'Mumbai', d(42), { notes: 'Preferred: Evening' }),
        ],
        decide: ['zonal', 'approve', 'Go ahead.'],
        book: { cost: 18450, ref: 'PNR 6E-4XK2Q / AI-7HM31', note: 'Hotel confirmation LT-55120' },
        tickets: [
          ['E-ticket Mumbai-Delhi.pdf', 'ticket', ['E-TICKET  (demo)', 'Passenger: SAMEER KHAN   PNR: 6E-4XK2Q',
            `${d(40)}  BOM 07:10 -> DEL 09:25   Economy`, `${d(42)}  DEL 19:40 -> BOM 21:55   Economy`]],
          ['Hotel voucher Delhi.pdf', 'hotel', ['HOTEL VOUCHER  (demo)', 'Lemon Tree Premier, Aerocity, New Delhi',
            `Check-in ${d(40)}   Check-out ${d(42)}   1 room`, 'Confirmation: LT-55120   Breakfast included']],
        ] },
      { by: 'hero', pastDays: 18, trip: { title: 'Mumbai → Nashik · Distributor review', purpose: 'Monthly distributor review and secondary sales audit', origin: 'Mumbai', destination: 'Nashik',
          start_date: d(31), end_date: d(31) },
        segments: [seg('cab', 'Mumbai', 'Nashik', d(31), { travel_class: 'economy_cab', notes: 'Return same day' })],
        decide: ['manager', 'approve', ''],
        book: { cost: 2400, ref: 'Cab MH-04-KX-2231', note: 'Driver: Santosh, 98190 22110' },
        tickets: [['Cab booking Nashik.pdf', 'ticket', ['CAB BOOKING  (demo)', 'Passenger: PRIYA SHARMA', `${d(-18)}  Mumbai (Andheri) -> Nashik, return same day`, 'Vehicle: MH-04-KX-2231 (Dzire)   Driver: Santosh']]] },
      { by: 'hero', trip: { title: 'Mumbai → Pune · Hospital tender', purpose: 'Rate contract presentation at Ruby Hall', origin: 'Mumbai', destination: 'Pune',
          start_date: d(33), end_date: d(33), justification: 'Early 9 am slot with the purchase committee' },
        segments: [seg('flight', 'Mumbai', 'Pune', d(33), { notes: 'Preferred: Early morning' })],
        decide: ['manager', 'reject', 'Pune is about 3 hours by road. Please take the Deccan Queen or an economy cab the evening before.'] },
    ],
  },

  indoco: {
    company: 'Indoco Remedies Ltd',
    domain: 'indoco.demo',
    title: 'TravelDesk for Indoco Remedies',
    intro: 'A demo prepared for Indoco’s field force: medical reps plan trips, managers approve, Corporate HR books. No sign-up.',
    footer: 'Prepared for Indoco Remedies Ltd · people and trips are sample data, not Indoco records',
    people: {
      hr: person('Pooja Desai', 'Corporate HR & Travel Desk', 'L5', 'admin', 'Corporate HR', null, null),
      zonal: person('Rajesh Iyer', 'Zonal Sales Manager (West)', 'L7', 'manager', 'Sales', null, null),
      manager: person('Sanjay Kulkarni', 'Regional Manager, Maharashtra', 'L6', 'manager', 'Sales', 'zonal', ['male', '1985-03-14', '98190 40112', 'Vegetarian', 'Lower']),
      hero: person('Amit Patil', 'Medical Representative', 'L2', 'employee', 'Sales', 'manager', ['male', '1995-07-22', '98190 52231', 'Vegetarian', 'Lower']),
      rep1: person('Kiran Shetty', 'Medical Representative', 'L2', 'employee', 'Sales', 'manager', ['male', '1997-12-05', '98190 63342', 'Non-vegetarian', 'Upper']),
      rep2: person('Snehal Jadhav', 'Medical Representative', 'L2', 'employee', 'Sales', 'manager', ['female', '1996-02-18', '98190 74453', 'Vegetarian', 'Lower']),
      pm: person('Farhan Shaikh', 'Product Manager', 'L4', 'employee', 'Marketing', 'zonal', ['male', '1990-09-09', '98190 85564', 'Non-vegetarian', 'Side lower']),
    },
    hotels: [
      ['mumbai', 'Hotel Orchid', 'Vile Parle East, near airport', 2450, true, 'Corporate rate for head-office visitors'],
      ['mumbai', 'Ginger Santacruz', 'Santacruz East', 1950, false, ''],
      ['aurangabad', 'Lemon Tree Aurangabad', 'Chikalthana', 1450, true, 'Near the medical college'],
      ['kolhapur', 'Hotel Pavillion', 'Station Road', 1350, true, ''],
      ['nashik', 'Ibis Nashik', 'Trimbak Road', 1500, true, ''],
      ['pune', 'Ibis Viman Nagar', 'Viman Nagar', 1850, true, ''],
      ['goa', 'Fidalgo', 'Panaji', 2200, true, 'Plant and training visits'],
      ['lucknow', 'Hotel Clarks Avadh', 'Mahatma Gandhi Marg', 1750, true, ''],
      ['patna', 'Hotel Maurya', 'Gandhi Maidan', 1950, true, ''],
    ],
    trips: ({ d, seg }) => [
      { by: 'rep1', trip: { title: 'Mumbai → Aurangabad · CME', purpose: 'Doctor calls and CME support at GMCH Aurangabad', origin: 'Mumbai', destination: 'Aurangabad',
          start_date: d(4), end_date: d(5), is_urgent: true, urgency_reason: 'CME brought forward by the hospital',
          justification: 'Short notice: date confirmed by the HOD this week' },
        segments: [
          seg('train', 'Mumbai', 'Aurangabad', d(4), { travel_class: 'sleeper', notes: 'Preferred: Night · No. 17617 Tapovan' }),
          seg('hotel', '', 'Aurangabad', d(4), { end_date: d(5), notes: 'Lemon Tree Aurangabad' }),
          seg('train', 'Aurangabad', 'Mumbai', d(5), { travel_class: 'sleeper', notes: 'Preferred: Night' }),
        ] },
      { by: 'rep2', with: ['rep1'], trip: { title: 'Mumbai → Kolhapur · Stockist meet', purpose: 'Quarterly stockist and chemist meet, South Maharashtra', origin: 'Mumbai', destination: 'Kolhapur',
          start_date: d(35), end_date: d(36) },
        segments: [
          seg('train', 'Mumbai', 'Kolhapur', d(35), { travel_class: 'sleeper', notes: 'Preferred: Night · No. 11029 Koyna' }),
          seg('hotel', '', 'Kolhapur', d(35), { end_date: d(36), rooms: 2, notes: 'Hotel Pavillion' }),
          seg('train', 'Kolhapur', 'Mumbai', d(36), { travel_class: 'sleeper', notes: 'Preferred: Night' }),
        ],
        decide: ['manager', 'approve', 'Approved. Carry the new detailing aids and the scheme sheet.'] },
      { by: 'pm', trip: { title: 'Mumbai → Lucknow · Brand launch', purpose: 'Launch meeting with UP & Bihar field teams and KOL doctors', origin: 'Mumbai', destination: 'Lucknow',
          start_date: d(40), end_date: d(42) },
        segments: [
          seg('flight', 'Mumbai', 'Lucknow', d(40), { notes: 'Preferred: Morning' }),
          seg('hotel', '', 'Lucknow', d(40), { end_date: d(42), notes: 'Hotel Clarks Avadh' }),
          seg('flight', 'Lucknow', 'Mumbai', d(42), { notes: 'Preferred: Evening' }),
        ],
        decide: ['zonal', 'approve', 'Go ahead.'],
        book: { cost: 16900, ref: 'PNR 6E-7QJ4M / 6E-7QJ9P', note: 'Hotel confirmation CA-20931' },
        tickets: [
          ['E-ticket Mumbai-Lucknow.pdf', 'ticket', ['E-TICKET  (demo)', 'Passenger: FARHAN SHAIKH   PNR: 6E-7QJ4M',
            `${d(40)}  BOM 06:55 -> LKO 09:05   Economy`, `${d(42)}  LKO 18:50 -> BOM 21:10   Economy`]],
          ['Hotel voucher Lucknow.pdf', 'hotel', ['HOTEL VOUCHER  (demo)', 'Hotel Clarks Avadh, Lucknow',
            `Check-in ${d(40)}   Check-out ${d(42)}   1 room`, 'Confirmation: CA-20931   Breakfast included']],
        ] },
      { by: 'hero', pastDays: 18, trip: { title: 'Mumbai → Nashik · Distributor review', purpose: 'Monthly distributor review and secondary sales check', origin: 'Mumbai', destination: 'Nashik',
          start_date: d(31), end_date: d(31) },
        segments: [seg('cab', 'Mumbai', 'Nashik', d(31), { travel_class: 'economy_cab', notes: 'Return same day' })],
        decide: ['manager', 'approve', ''],
        book: { cost: 2350, ref: 'Cab MH-02-FT-4418', note: 'Driver: Ganesh, 98200 61172' },
        tickets: [['Cab booking Nashik.pdf', 'ticket', ['CAB BOOKING  (demo)', 'Passenger: AMIT PATIL', `${d(-18)}  Mumbai (Santacruz) -> Nashik, return same day`, 'Vehicle: MH-02-FT-4418 (Dzire)   Driver: Ganesh']]] },
      { by: 'hero', trip: { title: 'Mumbai → Pune · Hospital tender', purpose: 'Rate contract presentation to a hospital purchase committee', origin: 'Mumbai', destination: 'Pune',
          start_date: d(33), end_date: d(33), justification: 'Early 9 am slot with the purchase committee' },
        segments: [seg('flight', 'Mumbai', 'Pune', d(33), { notes: 'Preferred: Early morning' })],
        decide: ['manager', 'reject', 'Pune is about 3 hours by road. Please take the Deccan Queen or an economy cab the evening before.'] },
    ],
  },
};

// ---------------------------------------------------------------- prospect demos
// Built from an industry template (job titles, trip purposes) and a region (base city, routes,
// names, hotels). Routes are chosen so the policy engine shows the intended result: the urgent and
// group trips go by train, the long trip qualifies for a flight (surface journey over 12 h), and the
// short "flight" is the out-of-policy one the manager rejects.

const INDUSTRY = {
  pharma: {
    team: 'field force', heroes: 'medical reps',
    titles: { hero: 'Medical Representative', rep: 'Medical Representative', manager: 'Regional Manager', zonal: 'Zonal Sales Manager', pm: 'Product Manager', pmDept: 'Marketing' },
    work: { urgent: ['CME', 'Doctor calls and CME support at the medical college', 'CME brought forward by the hospital'],
      group: ['Stockist meet', 'Quarterly stockist and chemist meet'], flight: ['Brand launch', 'Launch meeting with the zone’s field teams and KOL doctors'],
      past: ['Distributor review', 'Monthly distributor review and secondary sales check'], rejected: ['Hospital tender', 'Rate contract presentation to a hospital purchase committee'] },
  },
  agri: {
    team: 'field and dealer teams', heroes: 'sales officers',
    titles: { hero: 'Sales Officer', rep: 'Field Development Officer', manager: 'Regional Sales Manager', zonal: 'Zonal Business Head', pm: 'Product Manager', pmDept: 'Marketing' },
    work: { urgent: ['Pest outbreak visit', 'Field visit after dealers reported a pest outbreak', 'Dealers reported crop damage this week'],
      group: ['Dealer & farmer meet', 'Pre-season dealer and farmer meeting'], flight: ['Season planning', 'Kharif/Rabi season planning with the regional teams'],
      past: ['Distributor stock audit', 'Distributor stock and collection review'], rejected: ['Dealer conference', 'Dealer conference presentation'] },
  },
  building: {
    team: 'sales and dealer teams', heroes: 'sales executives',
    titles: { hero: 'Sales Executive', rep: 'Sales Executive (Projects)', manager: 'Regional Sales Manager', zonal: 'Zonal Head', pm: 'Key Account Manager', pmDept: 'Projects' },
    work: { urgent: ['Project site visit', 'Site visit for a builder’s complaint on a large project', 'Builder escalated a site issue'],
      group: ['Dealer meet', 'Dealer meet and new range display launch'], flight: ['Builder & architect meet', 'Presentation to builders and architects in the zone'],
      past: ['Dealer visits', 'Dealer visits and display audit'], rejected: ['Architect presentation', 'Presentation at an architects’ association'] },
  },
  paints: {
    team: 'sales and dealer teams', heroes: 'sales officers',
    titles: { hero: 'Sales Officer', rep: 'Sales Officer', manager: 'Regional Sales Manager', zonal: 'Zonal Sales Head', pm: 'Product Manager', pmDept: 'Marketing' },
    work: { urgent: ['Dealer escalation', 'Visit a key dealer after a shade and supply complaint', 'Key dealer escalated a complaint'],
      group: ['Painter & dealer meet', 'Painter contractor and dealer meet'], flight: ['Regional launch', 'Launch of the new range with the zone’s teams'],
      past: ['Depot review', 'Depot stock and dealer review'], rejected: ['Dealer conference', 'Dealer conference presentation'] },
  },
  electricals: {
    team: 'sales and channel teams', heroes: 'sales executives',
    titles: { hero: 'Sales Executive', rep: 'Sales Executive', manager: 'Regional Sales Manager', zonal: 'Zonal Head', pm: 'Product Manager', pmDept: 'Marketing' },
    work: { urgent: ['Distributor escalation', 'Visit a distributor after a stock and claims dispute', 'Distributor escalated a claims issue'],
      group: ['Electrician & retailer meet', 'Electrician and retailer loyalty meet'], flight: ['Channel partner meet', 'Annual channel partner meet for the zone'],
      past: ['Distributor review', 'Distributor and retailer review'], rejected: ['Retailer meet', 'Retailer scheme presentation'] },
  },
  consumer: {
    team: 'sales teams', heroes: 'sales executives',
    titles: { hero: 'Sales Executive', rep: 'Sales Executive (Modern Trade)', manager: 'Regional Sales Manager', zonal: 'Zonal Sales Head', pm: 'Category Manager', pmDept: 'Marketing' },
    work: { urgent: ['Store launch', 'Support a new store opening with a key retailer', 'Retailer moved the opening date up'],
      group: ['Distributor meet', 'Festive season distributor meet'], flight: ['Festive planning', 'Festive season planning with key accounts'],
      past: ['Store audit', 'Store and distributor audit'], rejected: ['Key account meeting', 'Key account review meeting'] },
  },
};

const REGION = {
  west: {
    label: 'West', base: 'Mumbai', urgent: 'Aurangabad', group: 'Kolhapur', flight: ['Lucknow', 'BOM', 'LKO'], past: 'Nashik', rejected: 'Pune',
    people: { hr: 'Meera Joshi', zonal: 'Rajiv Menon', manager: 'Nitin Deshpande', hero: 'Rohan Pawar', rep1: 'Sagar Patil', rep2: 'Neha Gaikwad', pm: 'Aditi Kulkarni' },
    hotels: [['mumbai', 'Ginger Andheri', 'Andheri East', 1950, false], ['aurangabad', 'Lemon Tree Aurangabad', 'Chikalthana', 1450, true],
      ['kolhapur', 'Hotel Pavillion', 'Station Road', 1350, true], ['lucknow', 'Hotel Clarks Avadh', 'Mahatma Gandhi Marg', 1750, true],
      ['nashik', 'Ibis Nashik', 'Trimbak Road', 1500, true], ['pune', 'Ibis Viman Nagar', 'Viman Nagar', 1850, true]],
  },
  north: {
    label: 'North', base: 'Delhi', urgent: 'Lucknow', group: 'Jaipur', flight: ['Bengaluru', 'DEL', 'BLR'], past: 'Agra', rejected: 'Chandigarh',
    people: { hr: 'Anjali Verma', zonal: 'Harpreet Singh', manager: 'Vivek Malhotra', hero: 'Ankit Sharma', rep1: 'Mohit Yadav', rep2: 'Pooja Rawat', pm: 'Karan Bhatia' },
    hotels: [['delhi', 'Lemon Tree Premier', 'Aerocity', 2450, true], ['lucknow', 'Hotel Clarks Avadh', 'Mahatma Gandhi Marg', 1750, true],
      ['jaipur', 'Ginger Jaipur', 'Sindhi Camp', 1450, false], ['bengaluru', 'Lemon Tree Ulsoor Lake', 'Ulsoor', 2450, true],
      ['agra', 'Hotel Atulyaa Taj', 'Fatehabad Road', 1600, true], ['chandigarh', 'Lemon Tree Chandigarh', 'Industrial Area', 1900, true]],
  },
  gujarat: {
    label: 'Gujarat', base: 'Ahmedabad', urgent: 'Rajkot', group: 'Indore', flight: ['Kolkata', 'AMD', 'CCU'], past: 'Vadodara', rejected: 'Udaipur',
    people: { hr: 'Kinjal Shah', zonal: 'Paresh Mehta', manager: 'Hardik Patel', hero: 'Jay Desai', rep1: 'Chirag Solanki', rep2: 'Riya Trivedi', pm: 'Nirav Joshi' },
    hotels: [['ahmedabad', 'Fortune Park', 'Ashram Road', 1950, true], ['rajkot', 'The Imperial Palace', 'Yagnik Road', 1700, true],
      ['indore', 'Lemon Tree Indore', 'Vijay Nagar', 1650, true], ['kolkata', 'Ibis Kolkata Rajarhat', 'New Town', 2200, true],
      ['vadodara', 'Ginger Vadodara', 'Alkapuri', 1400, false], ['udaipur', 'Hotel Lakend', 'Fatehsagar', 1900, true]],
  },
  south: {
    label: 'South', base: 'Bengaluru', urgent: 'Hubli', group: 'Coimbatore', flight: ['Delhi', 'BLR', 'DEL'], past: 'Mysuru', rejected: 'Chennai',
    people: { hr: 'Lakshmi Narayanan', zonal: 'Suresh Reddy', manager: 'Arun Kumar', hero: 'Karthik Rao', rep1: 'Vignesh Subramanian', rep2: 'Divya Menon', pm: 'Ramya Iyer' },
    hotels: [['bengaluru', 'Lemon Tree Ulsoor Lake', 'Ulsoor', 2450, true], ['hubli', 'Hotel Denissons', 'Gokul Road', 1650, true],
      ['coimbatore', 'Ibis Coimbatore', 'Avinashi Road', 1700, true], ['delhi', 'Lemon Tree Premier', 'Aerocity', 2450, true],
      ['mysuru', 'Ginger Mysore', 'Nazarbad', 1350, false], ['chennai', 'Ibis Chennai OMR', 'Sholinganallur', 2100, true]],
  },
};

const DETAILS = {
  manager: ['male', '1985-03-14', '98190 40112', 'Vegetarian', 'Lower'],
  hero: ['male', '1995-07-22', '98190 52231', 'Vegetarian', 'Lower'],
  rep1: ['male', '1997-12-05', '98190 63342', 'Non-vegetarian', 'Upper'],
  rep2: ['female', '1996-02-18', '98190 74453', 'Vegetarian', 'Lower'],
  pm: ['female', '1990-09-09', '98190 85564', 'Non-vegetarian', 'Side lower'],
};

function prospect({ company, short, industry, region }) {
  const ind = INDUSTRY[industry];
  const r = REGION[region];
  const t = ind.titles;
  const n = r.people;
  const w = ind.work;
  const upper = (s) => s.toUpperCase();
  return {
    company,
    domain: `${short.toLowerCase().replace(/[^a-z0-9]/g, '')}.demo`,
    title: `TravelDesk for ${short}`,
    intro: `A demo prepared for ${short}’s ${ind.team}: ${ind.heroes} plan trips, managers approve, HR books. No sign-up.`,
    footer: `Prepared for ${company} · people and trips are sample data, not ${short} records`,
    people: {
      hr: person(n.hr, 'HR & Travel Desk', 'L5', 'admin', 'Human Resources', null, null),
      zonal: person(n.zonal, `${t.zonal} (${r.label})`, 'L7', 'manager', 'Sales', null, null),
      manager: person(n.manager, `${t.manager}, ${r.base}`, 'L6', 'manager', 'Sales', 'zonal', DETAILS.manager),
      hero: person(n.hero, t.hero, 'L2', 'employee', 'Sales', 'manager', DETAILS.hero),
      rep1: person(n.rep1, t.rep, 'L2', 'employee', 'Sales', 'manager', DETAILS.rep1),
      rep2: person(n.rep2, t.rep, 'L2', 'employee', 'Sales', 'manager', DETAILS.rep2),
      pm: person(n.pm, t.pm, 'L4', 'employee', t.pmDept, 'zonal', DETAILS.pm),
    },
    hotels: r.hotels.map(([city, name, area, rate, bf]) => [city, name, area, rate, bf, '']),
    trips: ({ d, seg }) => {
      const B = r.base;
      const [fCity, fFrom, fTo] = r.flight;
      return [
        { by: 'rep1', trip: { title: `${B} → ${r.urgent} · ${w.urgent[0]}`, purpose: w.urgent[1], origin: B, destination: r.urgent,
            start_date: d(4), end_date: d(5), is_urgent: true, urgency_reason: w.urgent[2], justification: 'Short notice: confirmed this week' },
          segments: [
            seg('train', B, r.urgent, d(4), { travel_class: 'sleeper', notes: 'Preferred: Night' }),
            seg('hotel', '', r.urgent, d(4), { end_date: d(5) }),
            seg('train', r.urgent, B, d(5), { travel_class: 'sleeper', notes: 'Preferred: Night' }),
          ] },
        { by: 'rep2', with: ['rep1'], trip: { title: `${B} → ${r.group} · ${w.group[0]}`, purpose: w.group[1], origin: B, destination: r.group,
            start_date: d(35), end_date: d(36) },
          segments: [
            seg('train', B, r.group, d(35), { travel_class: 'sleeper', notes: 'Preferred: Night' }),
            seg('hotel', '', r.group, d(35), { end_date: d(36), rooms: 2 }),
            seg('train', r.group, B, d(36), { travel_class: 'sleeper', notes: 'Preferred: Night' }),
          ],
          decide: ['manager', 'approve', 'Approved. Share the meet agenda with the team.'] },
        { by: 'pm', trip: { title: `${B} → ${fCity} · ${w.flight[0]}`, purpose: w.flight[1], origin: B, destination: fCity,
            start_date: d(40), end_date: d(42) },
          segments: [
            seg('flight', B, fCity, d(40), { notes: 'Preferred: Morning' }),
            seg('hotel', '', fCity, d(40), { end_date: d(42) }),
            seg('flight', fCity, B, d(42), { notes: 'Preferred: Evening' }),
          ],
          decide: ['zonal', 'approve', 'Go ahead.'],
          book: { cost: 17800, ref: 'PNR 6E-5KD2W / 6E-5KD7R', note: 'Hotel confirmation HC-30417' },
          tickets: [
            [`E-ticket ${B}-${fCity}.pdf`, 'ticket', ['E-TICKET  (demo)', `Passenger: ${upper(n.pm)}   PNR: 6E-5KD2W`,
              `${d(40)}  ${fFrom} 07:05 -> ${fTo} 09:40   Economy`, `${d(42)}  ${fTo} 19:20 -> ${fFrom} 21:55   Economy`]],
            [`Hotel voucher ${fCity}.pdf`, 'hotel', ['HOTEL VOUCHER  (demo)', `${fCity}: ${r.hotels.find((h) => h[0] === fCity.toLowerCase())?.[1] || 'Business hotel'}`,
              `Check-in ${d(40)}   Check-out ${d(42)}   1 room`, 'Confirmation: HC-30417   Breakfast included']],
          ] },
        { by: 'hero', pastDays: 18, trip: { title: `${B} → ${r.past} · ${w.past[0]}`, purpose: w.past[1], origin: B, destination: r.past,
            start_date: d(31), end_date: d(31) },
          segments: [seg('cab', B, r.past, d(31), { travel_class: 'economy_cab', notes: 'Return same day' })],
          decide: ['manager', 'approve', ''],
          book: { cost: 2400, ref: 'Cab booking CB-88213', note: 'Driver details sent by SMS' },
          tickets: [[`Cab booking ${r.past}.pdf`, 'ticket', ['CAB BOOKING  (demo)', `Passenger: ${upper(n.hero)}`, `${d(-18)}  ${B} -> ${r.past}, return same day`, 'Booking: CB-88213   Sedan (Dzire or similar)']]] },
        { by: 'hero', trip: { title: `${B} → ${r.rejected} · ${w.rejected[0]}`, purpose: w.rejected[1], origin: B, destination: r.rejected,
            start_date: d(33), end_date: d(33), justification: 'Early morning slot' },
          segments: [seg('flight', B, r.rejected, d(33), { notes: 'Preferred: Early morning' })],
          decide: ['manager', 'reject', `${r.rejected} is a short journey by road or rail. Please take the train or an economy cab the evening before.`] },
      ];
    },
  };
}

// key = demo URL (/key). Kept in the same order as the outreach list.
const PROSPECTS = {
  morepen: { company: 'Morepen Laboratories Ltd', short: 'Morepen', industry: 'pharma', region: 'north' },
  mankind: { company: 'Mankind Pharma Ltd', short: 'Mankind', industry: 'pharma', region: 'north' },
  aurobindo: { company: 'Aurobindo Pharma Ltd', short: 'Aurobindo', industry: 'pharma', region: 'south' },
  dhanuka: { company: 'Dhanuka Agritech Ltd', short: 'Dhanuka', industry: 'agri', region: 'north' },
  ajeetseeds: { company: 'Ajeet Seeds', short: 'Ajeet Seeds', industry: 'agri', region: 'west' },
  rallis: { company: 'Rallis India Ltd', short: 'Rallis', industry: 'agri', region: 'west' },
  advanta: { company: 'Advanta India', short: 'Advanta', industry: 'agri', region: 'south' },
  asiangranito: { company: 'Asian Granito India Ltd', short: 'Asian Granito', industry: 'building', region: 'gujarat' },
  cera: { company: 'Cera Sanitaryware Ltd', short: 'Cera', industry: 'building', region: 'gujarat' },
  somany: { company: 'Somany Ceramics Ltd', short: 'Somany', industry: 'building', region: 'north' },
  hrjohnson: { company: 'H & R Johnson (India)', short: 'H & R Johnson', industry: 'building', region: 'west' },
  hindware: { company: 'Hindware Ltd', short: 'Hindware', industry: 'building', region: 'north' },
  inframarket: { company: 'Infra.Market', short: 'Infra.Market', industry: 'building', region: 'west' },
  shalimar: { company: 'Shalimar Paints Ltd', short: 'Shalimar Paints', industry: 'paints', region: 'north' },
  indigopaints: { company: 'Indigo Paints Ltd', short: 'Indigo Paints', industry: 'paints', region: 'west' },
  vguard: { company: 'V-Guard Industries Ltd', short: 'V-Guard', industry: 'electricals', region: 'south' },
  finolex: { company: 'Finolex Cables Ltd', short: 'Finolex Cables', industry: 'electricals', region: 'west' },
  safari: { company: 'Safari Industries (India) Ltd', short: 'Safari', industry: 'consumer', region: 'west' },
  vip: { company: 'VIP Industries Ltd', short: 'VIP Industries', industry: 'consumer', region: 'west' },
};

export const COMPANIES = { ...BASE, ...Object.fromEntries(Object.entries(PROSPECTS).map(([k, p]) => [k, prospect(p)])) };

