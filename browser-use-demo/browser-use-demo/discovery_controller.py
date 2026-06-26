"""Discovery Controller - orchestrates multi-page crawling using Page Discovery Agents."""

import asyncio
import json
import os
from urllib.parse import urljoin, urlparse

from dotenv import load_dotenv

from models import PageDiscoveryResult
from page_discovery_agent import discover_page

load_dotenv()


class DiscoveryController:
    """
    Orchestrates the discovery of multiple pages across a website.

    The controller manages:
    - Which pages have been visited
    - Which pages are queued for discovery
    - The shared browser session
    - The final application model (collection of all page models)
    """

    def __init__(
        self,
        base_url: str,
        max_pages: int = 20,
        max_concurrent: int = 1,
    ):
        """
        Args:
            base_url: The starting URL of the target application.
            max_pages: Maximum number of pages to discover.
            max_concurrent: Maximum concurrent discovery agents (default 1 for shared browser).
        """
        self.base_url = base_url
        self.base_domain = urlparse(base_url).netloc
        self.max_pages = max_pages
        self.max_concurrent = max_concurrent

        self.visited: set[str] = set()
        self.queue: list[str] = [base_url]
        self.results: list[PageDiscoveryResult] = []

    def _normalize_url(self, url: str) -> str:
        """Normalize a URL to avoid duplicates."""
        # Resolve relative URLs against base
        if url.startswith("/"):
            url = urljoin(self.base_url, url)
        elif not url.startswith("http"):
            url = urljoin(self.base_url, url)

        # Remove trailing slash for consistency
        parsed = urlparse(url)
        path = parsed.path.rstrip("/") or "/"
        return f"{parsed.scheme}://{parsed.netloc}{path}"

    def _is_valid_url(self, url: str) -> bool:
        """Check if a URL should be explored."""
        normalized = self._normalize_url(url)
        parsed = urlparse(normalized)

        # Must be same domain
        if parsed.netloc != self.base_domain:
            return False

        # Skip already visited
        if normalized in self.visited:
            return False

        # Skip non-page resources
        skip_extensions = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".css", ".js", ".ico", ".pdf"}
        if any(parsed.path.lower().endswith(ext) for ext in skip_extensions):
            return False

        # Skip anchors and mailto
        if url.startswith("#") or url.startswith("mailto:") or url.startswith("javascript:"):
            return False

        return True

    def _enqueue_candidates(self, candidates: list[str]) -> None:
        """Add candidate pages to the queue if they're valid."""
        for candidate in candidates:
            normalized = self._normalize_url(candidate)
            if self._is_valid_url(normalized) and normalized not in self.queue:
                self.queue.append(normalized)
                print(f"  [QUEUE] Added: {normalized}")

    async def _discover_single_page(self, url: str) -> PageDiscoveryResult | None:
        """Discover a single page with error handling."""
        normalized = self._normalize_url(url)

        if normalized in self.visited:
            return None

        self.visited.add(normalized)
        print(f"\n[DISCOVER] ({len(self.visited)}/{self.max_pages}) {normalized}")

        try:
            # Each page gets its own browser to avoid context pollution
            result = await discover_page(url=normalized, browser=None)
            return result
        except Exception as e:
            print(f"  [ERROR] Failed to discover {normalized}: {e}")
            import traceback
            traceback.print_exc()
            return None

    async def run(self) -> list[PageDiscoveryResult]:
        """
        Run the discovery process.

        Returns:
            List of PageDiscoveryResult for all discovered pages.
        """
        print(f"[START] Discovery Controller")
        print(f"  Base URL: {self.base_url}")
        print(f"  Max pages: {self.max_pages}")
        print(f"  Max concurrent: {self.max_concurrent}")
        print("=" * 60)

        while self.queue and len(self.visited) < self.max_pages:
            # Take next URL from queue
            url = self.queue.pop(0)
            normalized = self._normalize_url(url)

            if normalized in self.visited:
                continue

            # Discover the page (each call manages its own browser)
            result = await self._discover_single_page(normalized)

            if result:
                self.results.append(result)

                # Enqueue candidate pages
                if result.next_candidate_pages:
                    self._enqueue_candidates(result.next_candidate_pages)

                print(f"  [OK] Discovered: {result.page_type or 'Unknown'} - {result.title or normalized}")
                print(f"  [INFO] Found {len(result.next_candidate_pages)} candidate pages")
                print(f"  [INFO] Queue size: {len(self.queue)}")

        print("\n" + "=" * 60)
        print(f"[DONE] Discovered {len(self.results)} pages")
        print("=" * 60)

        return self.results

    def export_application_model(self, output_path: str = "output/application_model.json") -> None:
        """Export all discovery results as a single application model JSON file."""
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        model = {
            "base_url": self.base_url,
            "total_pages_discovered": len(self.results),
            "pages": [result.model_dump() for result in self.results],
        }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(model, f, indent=2, ensure_ascii=False)

        print(f"[EXPORT] Application model saved to: {output_path}")
