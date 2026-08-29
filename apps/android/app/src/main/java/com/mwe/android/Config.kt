package com.mwe.android

/**
 * Endpoint config for the demo stack running on your dev machine.
 *
 * - Android EMULATOR: the host machine is 10.0.2.2 (the defaults below), or
 *   run `adb reverse tcp:7461 tcp:7461 && adb reverse tcp:7462 tcp:7462` and
 *   use localhost instead.
 * - PHYSICAL DEVICE: replace with your machine's LAN IP; cleartext http is
 *   already allowed by the manifest (dev only).
 *
 * The dev JWT is the checked-in demo token (sub=user-demo). Re-mint with
 * `node scripts/mint-dev-token.mjs` and paste here to act as another user.
 */
object Config {
    const val AGENT_URL = "http://10.0.2.2:7462/agui"
    const val GRAPHQL_URL = "http://10.0.2.2:7461/graphql"
    const val DEV_JWT =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWRlbW8iLCJlbWFpbCI6ImRlbW9AZXhhbXBsZS5jb20iLCJuYW1lIjoiRGVtbyBVc2VyIiwiaWF0IjoxNzg3OTc4MjkzLCJleHAiOjIxMDMzMzgyOTN9.isX6kh2a1JReimbCgD9Dy5meEIpkaqnmtsr-_79_oFc"
}
