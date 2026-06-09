// netlify/functions/matches.js
// Netlify Serverless Function: Fetches match data from Supabase and returns JSON

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

exports.handler = async function (event, context) {
  // CORS headers so Blogger (or any frontend) can call this API
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Read optional query parameters
    const params = event.queryStringParameters || {};
    const dateParam = params.date; // e.g., ?date=2025-06-08
    const favoriteOnly = params.favorite !== 'false'; // default: only favorites

    // Build the date range for filtering
    let startOfDay, endOfDay;

    if (dateParam) {
      // Use the provided date
      startOfDay = new Date(`${dateParam}T00:00:00.000Z`).toISOString();
      endOfDay = new Date(`${dateParam}T23:59:59.999Z`).toISOString();
    } else {
      // Default to today (UTC)
      const today = new Date();
      const yyyy = today.getUTCFullYear();
      const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(today.getUTCDate()).padStart(2, '0');
      startOfDay = `${yyyy}-${mm}-${dd}T00:00:00.000Z`;
      endOfDay = `${yyyy}-${mm}-${dd}T23:59:59.999Z`;
    }

    // Query Supabase: join matches with home and away teams
    let query = supabase
      .from('matches')
      .select(`
        id,
        match_date,
        status_short,
        status_elapsed,
        home_goals,
        away_goals,
        stream_url,
        is_favorite,
        home_team:teams!matches_home_team_id_fkey (id, name, logo_url),
        away_team:teams!matches_away_team_id_fkey (id, name, logo_url)
      `)
      .gte('match_date', startOfDay)
      .lte('match_date', endOfDay)
      .order('match_date', { ascending: true });

    // Filter to favorites only if requested
    if (favoriteOnly) {
      query = query.eq('is_favorite', true);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Supabase query error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Database query failed', details: error.message }),
      };
    }

    // Format the response to match the structure the widget expects
    const formattedMatches = (data || []).map((match) => ({
      id: match.id,
      date: match.match_date,
      status: {
        short: match.status_short,
        elapsed: match.status_elapsed,
      },
      teams: {
        home: {
          id: match.home_team?.id,
          name: match.home_team?.name,
          logo: match.home_team?.logo_url,
        },
        away: {
          id: match.away_team?.id,
          name: match.away_team?.name,
          logo: match.away_team?.logo_url,
        },
      },
      goals: {
        home: match.home_goals,
        away: match.away_goals,
      },
      stream_url: match.stream_url,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        date: dateParam || new Date().toISOString().split('T')[0],
        results: formattedMatches.length,
        matches: formattedMatches,
      }),
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', details: err.message }),
    };
  }
};
