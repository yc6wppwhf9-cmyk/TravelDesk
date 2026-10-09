// Sample companies for the demo sandbox. Each URL (see DEMO_PATHS in ../client.js) loads one of
// these into its own in-browser database. People and trips are fictional.
//
// Every company has the same cast, addressed by role key:
//   hr (admin, books tickets) · zonal (approves the manager's and the PM's trips)
//   manager (approves the field team) · hero (the traveller prospects play) · rep1, rep2 · pm
// and the same five sample trips: an urgent trip awaiting approval, an approved group trip waiting
// to be booked, a booked flight with tickets, a past booked trip, and a rejected out-of-policy flight.

const person = (name, title, grade, role, dept, manager, details) => ({ name, title, grade, role, dept, manager, details });

export const COMPANIES = {
  sunrise: {
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
