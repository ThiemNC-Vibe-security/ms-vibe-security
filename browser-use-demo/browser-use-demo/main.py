import asyncio
import os

from dotenv import load_dotenv

from browser_use import Agent
from browser_use.llm.google.chat import ChatGoogle

load_dotenv()


async def main():
    llm = ChatGoogle(
        model="gemini-2.5-flash",
        api_key=os.getenv("GEMINI_API_KEY"),
    )

    agent = Agent(
        task="""
        Open https://vc-awg-demo-final-code.vercel.app/

        Tell me:
        1. What is this website?
        2. What is its purpose?
        """,
        llm=llm,
    )

    result = await agent.run()

    print(result)


if __name__ == "__main__":
    asyncio.run(main())