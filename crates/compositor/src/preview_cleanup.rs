/// A view's destructor waits for its decoder thread. Never run that join on
/// Electron's event loop: opening another project must not block Pause or IPC.
pub fn retire_view<T: Send + 'static>(view: T) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || drop(view))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn slow_decoder_shutdown_does_not_block_the_calling_thread() {
        struct SlowView {
            started: mpsc::Sender<std::thread::ThreadId>,
            release: mpsc::Receiver<()>,
            finished: mpsc::Sender<()>,
        }
        impl Drop for SlowView {
            fn drop(&mut self) {
                self.started.send(std::thread::current().id()).unwrap();
                // Bounded even if the caller accidentally starts joining again.
                let _ = self.release.recv_timeout(Duration::from_secs(1));
                self.finished.send(()).unwrap();
            }
        }
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (finished_tx, finished_rx) = mpsc::channel();
        let worker = retire_view(SlowView {
            started: started_tx,
            release: release_rx,
            finished: finished_tx,
        });
        assert_ne!(
            started_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            std::thread::current().id()
        );
        assert_eq!(finished_rx.try_recv(), Err(mpsc::TryRecvError::Empty));
        release_tx.send(()).unwrap();
        worker.join().unwrap();
        finished_rx.recv_timeout(Duration::from_secs(1)).unwrap();
    }
}
