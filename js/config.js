
/*
 * IPPAD Dashboard Configuration
 * Demo Simulation + Real-Time Hardware
 *
 * Replace the three placeholder values below
 * with your friend's IPPAD Supabase details.
 */

window.APP_CONFIG = {
    // Supabase project URL
    supabaseUrl: "https://chsdschfpdofyoxcieup.supabase.co",

    // Supabase publishable key (NOT service-role/secret key)
    supabasePublishableKey: "sb_publishable_YRtLBUUEQjakLMwJrn60Rw_6yHZklsx",

    // Must exactly match device_id stored in ippad_telemetry
    deviceId: "IPPAD_TEST_01",

    // IPPAD telemetry database table
    telemetryTable: "ippad_telemetry",

    // Database timestamp column
    timestampColumn: "recorded_at",

    // Keep both dashboard modes available
    defaultMode: "demo"
};
