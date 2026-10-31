# GPT VPN — Android starter (v1.0.0)

**Status: UI + architecture scaffold only. NOT a working VPN.**

This starter establishes the Android project structure for a privacy-first hybrid VPN client. It does not contain VPN servers, WireGuard peer credentials, a control-plane backend, or a working tunnel. The Connect button is intentionally disabled until a real, tested provisioning flow is implemented.

## Product goals
- Free to users; no subscriptions, premium tier, or in-app ads.
- Hybrid infrastructure: first-party nodes plus explicitly approved partner/community nodes.
- Server list must only show provisioned, verified nodes. No fabricated locations or health metrics.
- Privacy by design: no browsing-history, DNS-query, or traffic-content logging.
- Android publication target: Google Play, subject to policy review and completed testing.

## Architecture
1. Android app: UI, onboarding/consent, server selection, connection state.
2. Android `VpnService`: lifecycle and tunnel permission boundary (currently a safe stub).
3. Control plane (to be implemented): authenticated HTTPS API for server registry, provisioning, health, capacity, and provider attribution.
4. Node agents: WireGuard provisioning and health reporting on first-party/approved partner servers.
5. Hybrid registry: `FIRST_PARTY` and `PARTNER` source types; reject unverified or expired nodes.

## Important security requirements
- Generate WireGuard keypairs on-device; transmit only the public key for provisioning.
- Keep private keys in Android Keystore-backed storage.
- Never embed private keys, shared secrets, or server credentials in the APK or Git repository.
- Require explicit informed consent before starting a VPN.
- Use TLS, short-lived auth tokens, rate limits, and signed server configuration responses.
- Do not scrape public VPN config lists or redistribute configurations without permission.
- Add a verified-node gate before a server can appear as production-ready.

## Build
Open this project in Android Studio with Android SDK installed, then sync Gradle and build the `app` module.
- Android Gradle Plugin: 8.7.3
- Kotlin: 2.0.21
- Compile/target SDK: 35
- Minimum SDK: 26
- Java: 17

This ZIP does not include the Gradle wrapper JAR or Android SDK. Android Studio can generate/supply the wrapper.

## Test gates
- [ ] Build succeeds on a clean Android SDK environment.
- [ ] Consent and VPN permission flows reviewed.
- [ ] Real WireGuard tunnel integration added and audited.
- [ ] First-party node provisioned and independently tested.
- [ ] Partner node ownership/permission verified.
- [ ] DNS leak, IPv6 leak, reconnect, and kill-switch tests pass.
- [ ] Privacy policy and Data Safety declarations completed.
- [ ] Play Console VPN declaration and review completed.

Do not describe the app as a functioning VPN or publish it as such until the gates above pass.
