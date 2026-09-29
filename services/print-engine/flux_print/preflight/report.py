"""Résultat d'un preflight : constats classés par gravité et corrections appliquées."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class Severity(str, Enum):
    INFO = "info"
    WARNING = "warning"  # imprimable, mais le client doit être prévenu
    ERROR = "error"  # bloquant : le fichier ne part pas en production


@dataclass
class Finding:
    code: str
    severity: Severity
    message: str
    page: int | None = None  # numéro de page 1-based
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class Report:
    spec_code: str
    page_count: int = 0
    findings: list[Finding] = field(default_factory=list)
    fixes: list[str] = field(default_factory=list)

    def add(self, code: str, severity: Severity, message: str, page: int | None = None, **details: Any) -> None:
        self.findings.append(Finding(code, severity, message, page, details))

    def by_severity(self, severity: Severity) -> list[Finding]:
        return [f for f in self.findings if f.severity is severity]

    @property
    def passed(self) -> bool:
        return not self.by_severity(Severity.ERROR)

    def codes(self) -> set[str]:
        return {f.code for f in self.findings}

    def to_dict(self) -> dict[str, Any]:
        return {
            "spec": self.spec_code,
            "passed": self.passed,
            "page_count": self.page_count,
            "fixes": self.fixes,
            "findings": [{**asdict(f), "severity": f.severity.value} for f in self.findings],
        }
