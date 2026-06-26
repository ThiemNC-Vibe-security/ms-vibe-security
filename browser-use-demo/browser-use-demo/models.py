"""Pydantic models for Page Discovery Agent output."""

from pydantic import BaseModel, Field


class FormInput(BaseModel):
    label: str | None = ""
    name: str | None = ""
    type: str | None = ""
    required: bool = False
    placeholder: str | None = ""


class Form(BaseModel):
    name: str | None = ""
    action: str | None = ""
    method: str | None = ""
    inputs: list[FormInput] = Field(default_factory=list)
    validation: list[str] = Field(default_factory=list)


class Button(BaseModel):
    label: str | None = ""
    type: str | None = ""
    business_meaning: str | None = ""


class TableInfo(BaseModel):
    name: str | None = ""
    columns: list[str] = Field(default_factory=list)
    row_count: int | None = 0


class DialogInfo(BaseModel):
    name: str | None = ""
    trigger: str | None = ""
    purpose: str | None = ""


class LinkInfo(BaseModel):
    text: str = ""
    href: str | None = ""
    is_external: bool = False


class NavigationItem(BaseModel):
    label: str | None = ""
    href: str | None = ""
    section: str | None = ""  # navbar, sidebar, footer


class SecurityComponent(BaseModel):
    """A security-relevant UI component detected on the page."""
    component_type: str | None = ""
    description: str | None = ""
    location: str | None = ""


class PageError(BaseModel):
    """An error encountered during page discovery."""
    url: str | None = ""
    error_type: str | None = ""
    message: str | None = ""


class PageDiscoveryResult(BaseModel):
    """The structured output of a single page discovery."""

    url: str = ""
    title: str = ""
    page_type: str = ""
    breadcrumb: list[str] = Field(default_factory=list)
    authentication: str = ""  # anonymous, authenticated, role_based, admin, user
    language: str = ""
    navigation: list[NavigationItem] = Field(default_factory=list)
    forms: list[Form] = Field(default_factory=list)
    buttons: list[Button] = Field(default_factory=list)
    inputs: list[FormInput] = Field(default_factory=list)
    tables: list[TableInfo] = Field(default_factory=list)
    dialogs: list[DialogInfo] = Field(default_factory=list)
    links: list[LinkInfo] = Field(default_factory=list)
    business_actions: list[str] = Field(default_factory=list)
    security_components: list[SecurityComponent] = Field(default_factory=list)
    next_candidate_pages: list[str] = Field(default_factory=list)


class DiscoveryOutput(BaseModel):
    """Full output of the Browser Discovery Agent."""
    base_url: str = ""
    total_pages_discovered: int = 0
    pages: list[PageDiscoveryResult] = Field(default_factory=list)
    errors: list[PageError] = Field(default_factory=list)
