from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="EHR_",
        env_file=BACKEND_DIR / ".env",
        extra="ignore",
    )
    data_dir: Path = BACKEND_DIR.parent / "data"
    llm_provider: Literal["gemini", "openai"] = "gemini"
    gemini_model: str = "gemini-3.8-flash"
    openai_model: str = "gpt-4o-mini"
    gemini_api_key: SecretStr | None = Field(default=None, validation_alias="GEMINI_API_KEY")
    openai_api_key: SecretStr | None = Field(default=None, validation_alias="OPENAI_API_KEY")
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_revision: str = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
    cors_origins: list[str] = ["http://localhost:5173"]
    fhir_validator_jar: Path | None = None

    @field_validator("fhir_validator_jar", mode="before")
    @classmethod
    def empty_validator_path(cls, value: object) -> object:
        return None if value == "" else value

    @field_validator("data_dir", "fhir_validator_jar", mode="after")
    @classmethod
    def anchor_paths(cls, value: Path | None) -> Path | None:
        if value is None or value.is_absolute():
            return value
        return (BACKEND_DIR / value).resolve()
