"""Page Discovery Agent - discovers a single page and returns structured JSON."""

import asyncio
import json
import os

from dotenv import load_dotenv

from browser_use import Agent, Browser
from browser_use.llm.google.chat import ChatGoogle

from models import PageDiscoveryResult

load_dotenv()

DISCOVERY_PROMPT = """You are a Page Discovery Agent. Your ONLY job is to navigate to a URL, observe the page, and return a structured JSON describing everything you see.

Navigate to: {url}

After the page loads, carefully observe ALL elements on the page and create a JSON object.

Look for:
1. Page title and what type of page it is (Login, Dashboard, Landing Page, Register, etc.)
2. Navigation items (navbar, sidebar, footer links) - get label and href for each
3. Forms - get the form name, all input fields (label, name, type, required, placeholder)
4. Buttons - get label and what business action they represent
5. Tables - name and column headers
6. Links - text and href
7. Business actions - what can a user DO on this page? (e.g. "Login", "Register", "Create Account")
8. Next pages to explore - internal paths/URLs visible on this page

Authentication state: is this page anonymous (public), or does it require login?

When you are done observing, use the done action and provide ONLY a valid JSON object (no markdown, no explanation) with this structure:

{{"url": "the current url", "title": "page title", "page_type": "type", "breadcrumb": [], "authentication": "anonymous or authenticated", "navigation": [{{"label": "text", "href": "/path", "section": "navbar"}}], "forms": [{{"name": "form name", "action": "", "method": "POST", "inputs": [{{"label": "Email", "name": "email", "type": "email", "required": true, "placeholder": ""}}], "validation": []}}], "buttons": [{{"label": "Login", "type": "submit", "business_meaning": "Authenticate user"}}], "inputs": [], "tables": [{{"name": "table name", "columns": ["col1", "col2"], "row_count": 0}}], "dialogs": [{{"name": "dialog name", "trigger": "button click", "purpose": "confirm action"}}], "links": [{{"text": "link text", "href": "/path", "is_external": false}}], "business_actions": ["action1", "action2"], "next_candidate_pages": ["/page1", "/page2"]}}

CRITICAL RULES:
- Return ONLY the JSON in your done action. No other text before or after.
- Be thorough - capture every navigation item, every form, every button you can see.
- For next_candidate_pages, list all internal paths you can find on the page.
- Do NOT include empty arrays if there's nothing to report for that category - but DO include the key with an empty array.
"""


async def discover_page(
    url: str,
    browser: Browser | None = None,
) -> PageDiscoveryResult:
    """
    Discover a single page and return its structured model.

    Args:
        url: The URL to discover.
        browser: Optional shared browser instance.

    Returns:
        PageDiscoveryResult with the structured page data.
    """
    llm = ChatGoogle(
        model="gemini-2.5-flash",
        api_key=os.getenv("GEMINI_API_KEY"),
    )

    task = DISCOVERY_PROMPT.format(url=url)

    agent = Agent(
        task=task,
        llm=llm,
        browser=browser,
        use_vision=True,
        max_actions_per_step=10,
    )

    result = await agent.run()

    # Extract the final result text from agent
    final_result = result.final_result()

    if not final_result:
        # Try extracted_content as fallback
        extracted = result.extracted_content()
        if extracted:
            final_result = extracted[-1]  # Take the last extracted content
            print(f"[DEBUG] Using extracted_content fallback ({len(extracted)} items)")

    if not final_result:
        print(f"[WARN] No result returned for {url}")
        print(f"[DEBUG] is_done: {result.is_done()}")
        print(f"[DEBUG] has_errors: {result.has_errors()}")
        print(f"[DEBUG] errors: {result.errors()}")
        print(f"[DEBUG] action_names: {result.action_names()}")
        print(f"[DEBUG] extracted_content: {result.extracted_content()}")
        return PageDiscoveryResult(url=url)

    print(f"[DEBUG] Got result ({len(final_result)} chars)")

    # Parse JSON from the result
    try:
        import re

        # Try to extract JSON from the response
        json_str = final_result.strip()

        # Remove markdown code blocks if present
        if "```json" in json_str:
            json_str = json_str.split("```json")[1].split("```")[0]
        elif "```" in json_str:
            json_str = json_str.split("```")[1].split("```")[0]

        # Try to find JSON object in the text
        json_str = json_str.strip()
        if not json_str.startswith("{"):
            start = json_str.find("{")
            end = json_str.rfind("}")
            if start != -1 and end != -1:
                json_str = json_str[start:end + 1]

        # Fix common JSON issues from LLM output
        json_str = re.sub(r',\s*([}\]])', r'\1', json_str)  # trailing commas
        json_str = re.sub(r'^\s*//[^\n]*$', '', json_str, flags=re.MULTILINE)  # line comments only

        try:
            data = json.loads(json_str)
        except json.JSONDecodeError:
            # Brace-matching fallback
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

        return PageDiscoveryResult(**data)
    except (json.JSONDecodeError, Exception) as e:
        print(f"[WARN] Failed to parse discovery result for {url}: {e}")
        print(f"[DEBUG] Raw result: {final_result[:1000]}")
        return PageDiscoveryResult(url=url)


async def main():
    """Run a single page discovery as a standalone test."""
    url = "https://vc-awg-demo-final-code.vercel.app/"

    print(f"[INFO] Discovering page: {url}")
    result = await discover_page(url)

    print("\n" + "=" * 60)
    print("DISCOVERY RESULT")
    print("=" * 60)
    print(result.model_dump_json(indent=2))


if __name__ == "__main__":
    asyncio.run(main())
