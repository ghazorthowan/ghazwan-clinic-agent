import {Pool} from 'pg';
async function run(){const pool=new Pool({connectionString:process.env.DATABASE_URL});try{const count=await pool.query('SELECT count(*)::int AS c FROM bookings');if(count.rows[0].c) {console.log('Seed skipped; bookings exist');return;}
 const id='11111111-1111-4111-8111-111111111111';await pool.query(`INSERT INTO contacts(id,display_name,phone,source_channel,external_contact_ref) VALUES($1,'Demo Patient (synthetic)',NULL,'SIMULATED_WHATSAPP','demo-contact') ON CONFLICT DO NOTHING`,[id]);
 console.log('Created synthetic contact; use simulator to create bookings');}finally{await pool.end();}}
run().catch(e=>{console.error(e);process.exit(1)});
