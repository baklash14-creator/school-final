// ---------------------------------------------------------------
//  BAKARR SCHOOL - configuration
//  1) Paste your Supabase URL and ANON (public) key below.
//     Supabase Dashboard > Project Settings > API.
//     NEVER put the service_role key in this file.
//  2) Edit the school details; they appear on the public website.
// ---------------------------------------------------------------
export const CONFIG = {
  SUPABASE_URL: 'https://piojryombpoyrrfkrgew.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_zIzeeT7lTCErY0131aEPuQ_Iu7-Iwjb',

  SCHOOL: {
    name: 'Alfrian Int'l Academy & Sec. School',
    motto: 'Knowledge, character and service',
    email: 'info@bakarrschool.edu',
    phone: '+000 000 000 000',
    address: 'New york ',
    hours: 'Monday to Friday, 7:30 am to 4:00 pm',
  },

  // Levels shown on the website and in the admission form
  LEVELS: [
    { name: 'Nursery', ages: '3 to 5 years', text: 'Play-based learning, early literacy, numbers and social skills.' },
    { name: 'Primary', ages: '6 to 11 years', text: 'Strong foundations in English, mathematics, science and civic education.' },
    { name: 'Junior Secondary', ages: '12 to 14 years', text: 'Broader subjects, study habits and the first steps toward specialisation.' },
    { name: 'Senior Secondary', ages: '15 to 18 years', text: 'Focused examination preparation, career guidance and leadership.' },
  ],

  // Currency used for fees. Any ISO code; falls back to plain text if the browser does not know it.
  CURRENCY: 'SLE',

  // Turn on once the notify-external Edge Function is deployed (email/SMS)
  EXTERNAL_NOTIFICATIONS: false,

  // Sign users out after this many idle minutes
  IDLE_MINUTES: 30,

  // Keep in sync with public.grade_for() in supabase/schema.sql
  GRADES: [
    { min: 80, grade: 'A', remark: 'Excellent' },
    { min: 70, grade: 'B', remark: 'Very good' },
    { min: 60, grade: 'C', remark: 'Good' },
    { min: 50, grade: 'D', remark: 'Fair' },
    { min: 40, grade: 'E', remark: 'Pass' },
    { min: 0, grade: 'F', remark: 'Fail' },
  ],
};

export const isConfigured = () =>
  !CONFIG.SUPABASE_URL.includes('YOUR-PROJECT') && !CONFIG.SUPABASE_ANON_KEY.includes('YOUR-ANON');
