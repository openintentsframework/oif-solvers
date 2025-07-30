//! HTTP server for the OIF Solver API.
//!
//! This module provides a minimal HTTP server infrastructure 
//! for the OIF Solver API.

use actix_cors::Cors;
use actix_web::{
    middleware::Logger,
    web::{self, Data, Json},
    App, HttpResponse, HttpServer, Result as ActixResult,
};
use solver_config::ApiConfig;
use solver_core::SolverEngine;
use solver_types::{ErrorResponse, GetQuoteRequest};
use std::sync::Arc;
use tracing::{info, warn};

/// Shared application state for the API server.
#[derive(Clone)]
pub struct AppState {
    /// Reference to the solver engine for processing requests.
    pub solver: Arc<SolverEngine>,
}

/// Starts the HTTP server for the API.
///
/// This function creates and configures the HTTP server with routing,
/// middleware, and error handling for the endpoint.
pub async fn start_server(
    config: ApiConfig,
    solver: Arc<SolverEngine>,
) -> Result<(), Box<dyn std::error::Error>> {
    let app_state = AppState { solver };
    let bind_address = format!("{}:{}", config.host, config.port);
    
    info!("OIF Solver API server starting on {}", bind_address);

    HttpServer::new(move || {
        App::new()
            .app_data(Data::new(app_state.clone()))
            .app_data(web::JsonConfig::default().limit(config.max_request_size))
            .wrap(Logger::default())
            .wrap(
                Cors::default()
                    .allow_any_origin()
                    .allow_any_method()
                    .allow_any_header()
                    .max_age(3600),
            )
            .service(
                web::scope("/api")
                    .route("/quote", web::post().to(handle_quote))
            )
    })
    .bind(&bind_address)?
    .run()
    .await?;

    Ok(())
}

/// Handles POST /quote requests.
///
/// This endpoint processes quote requests and returns price estimates
/// for cross-chain intents following the ERC-7683 standard.
async fn handle_quote(
    app_state: Data<AppState>,
    request: Json<GetQuoteRequest>,
) -> ActixResult<HttpResponse> {
    match crate::apis::quote::process_quote_request(request.into_inner(), &app_state.solver).await {
        Ok(response) => Ok(HttpResponse::Ok().json(response)),
        Err(e) => {
            warn!("Quote request failed: {}", e);
            Ok(HttpResponse::BadRequest().json(ErrorResponse {
                error: "QUOTE_ERROR".to_string(),
                message: e.to_string(),
                details: None,
                retry_after: None,
            }))
        }
    }
} 