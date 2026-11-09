# Google Sheets Mapping (A:T)

The code in `lib/sheets.ts` writes a full snapshot using:

A Booking_ID; B Created_At; C Patient_Name; D Contact_Phone; E Respond_Contact_ID (internal contact UUID); F Source_Channel; G Source_Conversation_ID (blank in starter); H Visit_Date; I Clinic_Hours; J Booking_Status; K Patient_Confirmed_At; L Reminder_Status (NOT_CONFIGURED); M Message_Consent (blank in starter); N Assigned_Secretary (blank); O Arrival_Time; P Arrival_Sequence; Q Attendance_Status; R Last_Updated_At; S Last_Action_ID (blank); T Admin_Note (blank).

**Do not enter data manually into the sync tab**. The sync action clears and rewrites it. Use a separate read-only dashboard or other Sheet tab for formulas. Prefer the DB and dashboard for writes.

Service account: enable Sheets API in Google Cloud project, share the spreadsheet with service account, set environment variables on the server (never in client-side JavaScript). Production should use workload identity rather than downloadable long-lived service account keys if possible.
