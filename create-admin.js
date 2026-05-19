require('dotenv').config();

async function createAdminUser() {
  const email = 'johns@admin.com';
  const password = '123ewqasd';
  const role = 'admin';

  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kcjsfxkqmhqzatidizgp.supabase.co';
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SERVICE_ROLE_KEY) {
    console.error('SUPABASE_SERVICE_ROLE_KEY not found in .env');
    process.exit(1);
  }

  try {
    console.log('Creating admin user in Supabase Auth...');
    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey': SERVICE_ROLE_KEY
      },
      body: JSON.stringify({
        email,
        password,
        user_metadata: {
          full_name: 'John Admin',
          role: role,
          company_id: 'primary'
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.msg === 'User already registered') {
        console.log('Admin user already exists in Supabase Auth');
      } else {
        console.error('Error:', data);
        process.exit(1);
      }
    } else {
      console.log('Admin user created successfully!');
      console.log('User ID:', data.id);
    }
  } catch (err) {
    console.error('Request failed:', err);
    process.exit(1);
  }
}

createAdminUser();