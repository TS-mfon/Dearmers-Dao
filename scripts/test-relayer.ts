async function main() {
  const domains = [
    "https://testnet.relayer.1shotapi.com/relayers",
    "https://relayer.testnet.1shotapi.com/relayers",
    "https://sepolia.relayer.1shotapi.com/relayers",
    "https://relayer.sepolia.1shotapi.com/relayers",
    "https://sepolia-relayer.1shotapi.com/relayers",
    "https://relayer.1shotapi.com/relayers"
  ];
  
  const chainId = "84532";

  console.log("=== SCANNING SUBDOMAINS FOR BASE SEPOLIA ===");
  for (const domain of domains) {
    try {
      console.log(`\nDomain: ${domain}`);
      const response = await fetch(domain, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "relayer_getCapabilities",
          params: [chainId]
        }),
      });
      const res = await response.json();
      console.log("Response:", JSON.stringify(res));
    } catch (e: any) {
      console.log("Failed:", e.message);
    }
  }
}

main().catch(console.error);
