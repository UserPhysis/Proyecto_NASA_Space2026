# Servicio de análisis estadístico

Este servicio será el puente entre Farmer Query y los modelos en Python. La interfaz Next.js puede enviar una serie temporal de NASA POWER junto con el rango de necesidad del cultivo y recibir una respuesta lista para graficar:

```json
{
  "series": [{"date": "2026-01", "actual": 142.4, "forecast": null, "need_min": 120, "need_max": 180}],
  "status": "aceptable",
  "summary": {"mean": 151.2, "trend": "estable", "coverage": 0.86}
}
```

Flujo recomendado:

1. Next.js obtiene clima y suelo por coordenadas desde NASA POWER/GIBS y normaliza la respuesta.
2. Python recibe datos con una misma granularidad temporal, valida faltantes y calcula tendencia, media móvil, proyección y cobertura del rango del cultivo.
3. `/analizar` dibuja `actual`, `forecast` y `need_min/need_max`; `/pronostico` usa el mismo contrato con un horizonte mayor.
4. El modelo entrenado puede reemplazar `forecast_values` sin cambiar el frontend.

Para arrancar localmente: `pip install -r requirements.txt` y `uvicorn analysis:app --reload --port 8000`.
