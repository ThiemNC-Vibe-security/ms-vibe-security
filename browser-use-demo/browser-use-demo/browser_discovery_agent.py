"""Browser Discovery Agent - full website discovery with timestamped output and error handling."""

import asyncio
import json
import os
import traceback
from datetime import datetime
from urllib.parse import urljoin, urlparse

from dotenv import load_dotenv

from browser_use import Agent, Browser
from browser_use.llm.google.chat import ChatGoogle

from models import (
    DiscoveryOutput,
    PageDiscoveryResult,
    PageError,
    SecurityComponent,
)

load_dotenv()

DISCOVERY_PROMPT = """Navigate to {url} and extract ALL information about this webpage.

You MUST use the done action with a JSON object as your final output.

After the page loads, identify:
- Page title and URL
- Page type (Login, Dashboard, Landing Page, Register, Form, etc.)
- Authentication state (anonymous or authenticated)
- Language (vi, en, etc.)
- All navigation items (navbar, sidebar, footer) with their labels and links
- All forms with their input fields (label, name, type, required, placeholder)
- All buttons with their labels
- All data tables
- All links
- What business actions users can perform
- Security-sensitive components (login forms, password fields, search boxes, file uploads, payment forms, admin functions)
- Internal URLs that should be explored next

Your done action text MUST be ONLY a JSON object starting with {{ and ending with }}.
Do NOT include any explanation or text before or after the JSON.

The JSON must have this structure:
{{"url": "{url}", "title": "", "page_type": "", "breadcrumb": [], "authentication": "", "language": "", "navigation": [], "forms": [], "buttons": [], "inputs": [], "tables": [], "dialogs": [], "links": [], "business_actions": [], "security_components": [], "next_candidate_pages": []}}

Each navigation item: {{"label": "text", "href": "/path", "section": "navbar"}}
Each form: {{"name": "form name", "action": "", "method": "POST", "inputs": [{{"label": "", "name": "", "type": "", "required": false, "placeholder": ""}}], "validation": []}}
Each button: {{"label": "text", "type": "submit", "business_meaning": "what it does"}}
Each security component: {{"component_type": "login_form", "description": "what it is", "location": "where on page"}}

REMEMBER: Your done action must contain ONLY the JSON. No other text."""


class BrowserDiscoveryAgent:
    """
    Browser Discovery Agent - explores a target website and produces
    a structured representation with timestamped output files.

    Key differences from the simple DiscoveryController:
    - Timestamped output files (never overwrites)
    - Security component detection
    - Error tracking (continues on failure)
    - Language detection
    - Richer discovery prompt
    """

    def __init__(
        self,
        base_url: str,
        max_pages: int = 10,
        output_dir: str = "output",
    ):
        self.base_url = base_url
        self.base_domain = urlparse(base_url).netloc
        self.max_pages = max_pages
        self.output_dir = output_dir

        self.visited: set[str] = set()
        self.queue: list[str] = [base_url]
        self.results: list[PageDiscoveryResult] = []
        self.errors: list[PageError] = []

    def _normalize_url(self, url: str) -> str:
        """Normalize a URL to avoid duplicates."""
        if url.startswith("/"):
            url = urljoin(self.base_url, url)
        elif not url.startswith("http"):
            url = urljoin(self.base_url, url)

        parsed = urlparse(url)
        path = parsed.path.rstrip("/") or "/"
        return f"{parsed.scheme}://{parsed.netloc}{path}"

    def _is_valid_url(self, url: str) -> bool:
        """Check if a URL should be explored."""
        normalized = self._normalize_url(url)
        parsed = urlparse(normalized)

        if parsed.netloc != self.base_domain:
            return False

        if normalized in self.visited:
            return False

        skip_extensions = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".css", ".js", ".ico", ".pdf", ".zip", ".doc", ".docx"}
        if any(parsed.path.lower().endswith(ext) for ext in skip_extensions):
            return False

        if url.startswith("#") or url.startswith("mailto:") or url.startswith("javascript:") or url.startswith("tel:"):
            return False

        return True

    def _enqueue_candidates(self, candidates: list[str]) -> None:
        """Add candidate pages to the queue if valid."""
        for candidate in candidates:
            normalized = self._normalize_url(candidate)
            if self._is_valid_url(normalized) and normalized not in self.queue:
                self.queue.append(normalized)
                print(f"    [QUEUE+] {normalized}")

    async def _discover_single_page(self, url: str) -> PageDiscoveryResult | None:
        """Discover a single page. Returns None on failure (error is recorded)."""
        print(f"\n[DISCOVER] ({len(self.visited) + 1}/{self.max_pages}) {url}")

        try:
            llm = ChatGoogle(
                model="gemini-2.5-flash",
                api_key=os.getenv("GEMINI_API_KEY"),
            )

            task = DISCOVERY_PROMPT.format(url=url)

            agent = Agent(
                task=task,
                llm=llm,
                browser=None,  # Each page gets fresh browser
                use_vision=True,
                max_actions_per_step=10,
            )

            result = await agent.run()

            # Extract result
            final_result = result.final_result()

            if not final_result or "{" not in final_result:
                # final_result is text description, not JSON — try extracted_content
                extracted = result.extracted_content()
                if extracted:
                    # Look through all extracted content for one that contains JSON
                    for content in reversed(extracted):
                        if "{" in content and "url" in content:
                            final_result = content
                            print(f"    [FALLBACK] Found JSON in extracted_content")
                            break
                    if not final_result or "{" not in final_result:
                        final_result = extracted[-1]
                        print(f"    [FALLBACK] Using last extracted_content")

            if not final_result:
                print(f"    [WARN] No result returned")
                print(f"    [DEBUG] is_done={result.is_done()}, errors={result.errors()}")
                self.errors.append(PageError(
                    url=url,
                    error_type="empty_result",
                    message="Agent returned no result",
                ))
                return None

            print(f"    [OK] Got {len(final_result)} chars")
            print(f"    [RAW] {repr(final_result[:200])}")

            # If result doesn't contain JSON at all, skip
            if "{" not in final_result:
                print(f"    [ERROR] Result has no JSON content")
                self.errors.append(PageError(
                    url=url,
                    error_type="no_json",
                    message=f"Agent returned text instead of JSON: {final_result[:100]}",
                ))
                return None

            # Parse JSON
            json_str = final_result.strip()
            if "```json" in json_str:
                json_str = json_str.split("```json")[1].split("```")[0]
            elif "```" in json_str:
                json_str = json_str.split("```")[1].split("```")[0]

            json_str = json_str.strip()
            if not json_str.startswith("{"):
                start = json_str.find("{")
                end = json_str.rfind("}")
                if start != -1 and end != -1:
                    json_str = json_str[start:end + 1]

            # Fix common JSON issues from LLM output
            import re
            # Remove trailing commas before } or ]
            json_str = re.sub(r',\s*([}\]])', r'\1', json_str)
            # Remove single-line comments ONLY at the start of a line (not inside strings like URLs)
            json_str = re.sub(r'^\s*//[^\n]*$', '', json_str, flags=re.MULTILINE)

            print(f"    [CLEANED] {repr(json_str[:200])}")

            try:
                data = json.loads(json_str)
            except json.JSONDecodeError:
                # Last resort: try to find valid JSON by progressively trimming
                # Sometimes LLM adds text after the JSON
                brace_count = 0
                json_end = -1
                json_start = json_str.find("{")
                if json_start != -1:
                    for i in range(json_start, len(json_str)):
                        if json_str[i] == "{":
                            brace_count += 1
                        elif json_str[i] == "}":
                            brace_count -= 1
                            if brace_count == 0:
                                json_end = i
                                break
                    if json_end != -1:
                        json_str = json_str[json_start:json_end + 1]
                        json_str = re.sub(r',\s*([}\]])', r'\1', json_str)
                        data = json.loads(json_str)
                    else:
                        raise
                else:
                    raise

            page_result = PageDiscoveryResult(**data)
            return page_result

        except json.JSONDecodeError as e:
            print(f"    [ERROR] JSON parse failed: {e}")
            self.errors.append(PageError(
                url=url,
                error_type="parse_error",
                message=f"JSON parse error: {str(e)}",
            ))
            return None

        except Exception as e:
            print(f"    [ERROR] {type(e).__name__}: {e}")
            traceback.print_exc()
            self.errors.append(PageError(
                url=url,
                error_type="crash",
                message=f"{type(e).__name__}: {str(e)}",
            ))
            return None

    async def run(self) -> DiscoveryOutput:
        """
        Run the full discovery process.

        Returns:
            DiscoveryOutput with all pages and errors.
        """
        print("=" * 70)
        print("  BROWSER DISCOVERY AGENT")
        print("=" * 70)
        print(f"  Target:     {self.base_url}")
        print(f"  Max pages:  {self.max_pages}")
        print(f"  Output dir: {self.output_dir}")
        print("=" * 70)

        while self.queue and len(self.visited) < self.max_pages:
            url = self.queue.pop(0)
            normalized = self._normalize_url(url)

            if normalized in self.visited:
                continue

            self.visited.add(normalized)

            # Discover (continues on error)
            result = await self._discover_single_page(normalized)

            if result:
                self.results.append(result)

                # Enqueue candidates
                if result.next_candidate_pages:
                    self._enqueue_candidates(result.next_candidate_pages)

                page_type = result.page_type or "Unknown"
                title = result.title or normalized
                sec_count = len(result.security_components)
                print(f"    [DONE] {page_type} | {title}")
                print(f"    [INFO] {len(result.next_candidate_pages)} candidates, {sec_count} security components")
                print(f"    [INFO] Queue: {len(self.queue)} remaining")

        # Build output
        output = DiscoveryOutput(
            base_url=self.base_url,
            total_pages_discovered=len(self.results),
            pages=self.results,
            errors=self.errors,
        )

        print("\n" + "=" * 70)
        print("  DISCOVERY COMPLETE")
        print("=" * 70)
        print(f"  Pages discovered: {len(self.results)}")
        print(f"  Errors:           {len(self.errors)}")
        print(f"  Pages in queue:   {len(self.queue)} (not visited)")
        print("=" * 70)

        return output

    def save(self, output: DiscoveryOutput) -> str:
        """
        Save discovery output to a timestamped JSON file.
        Never overwrites existing files.

        Returns:
            The file path of the saved output.
        """
        os.makedirs(self.output_dir, exist_ok=True)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"discovery_{timestamp}.json"
        filepath = os.path.join(self.output_dir, filename)

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(output.model_dump(), f, indent=2, ensure_ascii=False)

        print(f"\n[SAVED] {filepath}")
        return filepath


async def main():
    """Run Browser Discovery Agent standalone."""
    import argparse

    parser = argparse.ArgumentParser(description="Browser Discovery Agent")
    parser.add_argument(
        "--url",
        type=str,
        default="https://vc-awg-demo-final-code.vercel.app/",
        help="Target URL to discover",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=5,
        help="Maximum pages to discover (default: 5)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="output",
        help="Output directory for discovery files",
    )

    args = parser.parse_args()

    agent = BrowserDiscoveryAgent(
        base_url=args.url,
        max_pages=args.max_pages,
        output_dir=args.output_dir,
    )

    output = await agent.run()
    filepath = agent.save(output)

    # Print summary
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


if __name__ == "__main__":
    asyncio.run(main())
