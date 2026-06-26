"""Main entry point to run discovery agents."""

import asyncio
import argparse


async def run_page_discovery(args):
    """Run the simple Page Discovery Agent (DiscoveryController)."""
    from discovery_controller import DiscoveryController

    controller = DiscoveryController(
        base_url=args.url,
        max_pages=args.max_pages,
    )

    results = await controller.run()
    controller.export_application_model(output_path=args.output)

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    for result in results:
        print(f"  [{result.page_type or '?'}] {result.url}")
        if result.business_actions:
            for action in result.business_actions[:3]:
                print(f"    - {action}")
    print(f"\nTotal pages: {len(results)}")
    print(f"Output: {args.output}")


async def run_browser_discovery(args):
    """Run the Browser Discovery Agent (full-featured)."""
    from browser_discovery_agent import BrowserDiscoveryAgent

    agent = BrowserDiscoveryAgent(
        base_url=args.url,
        max_pages=args.max_pages,
        output_dir=args.output_dir,
    )

    output = await agent.run()
    filepath = agent.save(output)

    print("\n  SUMMARY")
    print("  " + "-" * 40)
    for page in output.pages:
        sec = f" [{len(page.security_components)} sec]" if page.security_components else ""
        print(f"  [{page.page_type or '?'}] {page.url}{sec}")
        for action in page.business_actions[:3]:
            print(f"      - {action}")

    if output.errors:
        print(f"\n  ERRORS ({len(output.errors)}):")
        for err in output.errors:
            print(f"    [{err.error_type}] {err.url}: {err.message[:80]}")

    print(f"\n  Output: {filepath}")


async def main():
    parser = argparse.ArgumentParser(description="Website Discovery Agents")
    parser.add_argument(
        "--agent",
        type=str,
        choices=["page", "browser"],
        default="browser",
        help="Agent to use: 'page' (simple) or 'browser' (full-featured, default)",
    )
    parser.add_argument(
        "--url",
        type=str,
        default="https://vc-awg-demo-final-code.vercel.app/",
        help="Target URL to start discovery from",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=5,
        help="Maximum number of pages to discover (default: 5)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="output/application_model.json",
        help="Output file path (for page agent)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="output",
        help="Output directory (for browser agent, timestamped files)",
    )

    args = parser.parse_args()

    if args.agent == "page":
        await run_page_discovery(args)
    else:
        await run_browser_discovery(args)


if __name__ == "__main__":
    asyncio.run(main())
