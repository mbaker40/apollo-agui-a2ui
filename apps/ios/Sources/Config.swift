import Foundation

/// Endpoint config for the demo stack running on your dev machine.
///
/// - SIMULATOR: localhost reaches the host directly (the defaults below).
/// - PHYSICAL DEVICE: replace with your machine's LAN IP; the Info.plist
///   already sets NSAllowsLocalNetworking (dev only).
///
/// The dev JWT is the checked-in demo token (sub=user-demo). Re-mint with
/// `node scripts/mint-dev-token.mjs` and paste here to act as another user.
enum Config {
    static let agentURL = URL(string: "http://localhost:7462/agui")!
    static let graphqlURL = URL(string: "http://localhost:7461/graphql")!
    static let devJWT =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWRlbW8iLCJlbWFpbCI6ImRlbW9AZXhhbXBsZS5jb20iLCJuYW1lIjoiRGVtbyBVc2VyIiwiaWF0IjoxNzg3OTc4MjkzLCJleHAiOjIxMDMzMzgyOTN9.isX6kh2a1JReimbCgD9Dy5meEIpkaqnmtsr-_79_oFc"
}
