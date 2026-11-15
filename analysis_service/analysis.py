from statistics import mean
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Farmer Query Analysis API", version="0.1.0")


class Point(BaseModel):
    date: str
    value: float


class AnalysisRequest(BaseModel):
    points: list[Point] = Field(min_length=2)
    need_min: float
    need_max: float
    forecast_values: list[float] = []


def classify(values: list[float], minimum: float, maximum: float) -> Literal["aceptable", "bajo", "alto"]:
    if all(minimum <= value <= maximum for value in values):
        return "aceptable"
    if mean(values) < minimum:
        return "bajo"
    return "alto"


@app.post("/analysis")
def analyze(payload: AnalysisRequest):
    actual = [point.value for point in payload.points]
    forecast = payload.forecast_values or [actual[-1]] * 3
    joined = actual + forecast
    status = classify(joined, payload.need_min, payload.need_max)
    direction = "estable"
    if actual[-1] - actual[0] > 5:
        direction = "ascendente"
    elif actual[0] - actual[-1] > 5:
        direction = "descendente"

    return {
        "series": [
            {"date": point.date, "actual": point.value, "forecast": None, "need_min": payload.need_min, "need_max": payload.need_max}
            for point in payload.points
        ] + [
            {"date": f"forecast-{index + 1}", "actual": None, "forecast": value, "need_min": payload.need_min, "need_max": payload.need_max}
            for index, value in enumerate(forecast)
        ],
        "status": status,
        "summary": {"mean": round(mean(actual), 2), "trend": direction, "coverage": round(sum(payload.need_min <= value <= payload.need_max for value in joined) / len(joined), 2)},
    }
